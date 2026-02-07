/**
 * Google Sheets Client
 * API client for reading and writing to Google Sheets
 */

import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { configManager } from '../../config';
import { logger } from '../../core/logger';

/**
 * Row data from a sheet
 */
export interface SheetRow {
  rowIndex: number;
  values: Record<string, string>;
}

/**
 * Sheet metadata
 */
export interface SheetInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

/**
 * Google Sheets Client class
 */
export class GoogleSheetsClient {
  private sheets: sheets_v4.Sheets | null = null;
  private headerCache: Map<string, string[]> = new Map();

  /**
   * Initialize the Google Sheets API client
   */
  async initialize(): Promise<void> {
    // Try different authentication methods
    let auth;

    // 1. Try service account credentials file
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credentialsPath && fs.existsSync(credentialsPath)) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      logger.info('Google Sheets: Using service account credentials');
    }
    // 2. Try API key (read-only)
    else if (process.env.GOOGLE_SHEETS_API_KEY) {
      auth = process.env.GOOGLE_SHEETS_API_KEY;
      logger.info('Google Sheets: Using API key (read-only mode)');
    }
    // 3. Try application default credentials
    else {
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      logger.info('Google Sheets: Using application default credentials');
    }

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  /**
   * Get the sheets API client
   */
  private getClient(): sheets_v4.Sheets {
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized. Call initialize() first.');
    }
    return this.sheets;
  }

  /**
   * Get spreadsheet ID from config
   */
  private getSpreadsheetId(): string {
    return configManager.get().googleSheets.spreadsheetId;
  }

  /**
   * Get information about all sheets in the spreadsheet
   */
  async getSheetsList(): Promise<SheetInfo[]> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    return (response.data.sheets || []).map(sheet => ({
      sheetId: sheet.properties?.sheetId || 0,
      title: sheet.properties?.title || '',
      rowCount: sheet.properties?.gridProperties?.rowCount || 0,
      columnCount: sheet.properties?.gridProperties?.columnCount || 0,
    }));
  }

  /**
   * Get headers (first row) of a sheet
   */
  async getHeaders(sheetName: string): Promise<string[]> {
    // Check cache first
    const cached = this.headerCache.get(sheetName);
    if (cached) return cached;

    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!1:1`,
    });

    const headers = (response.data.values?.[0] || []) as string[];
    
    // Normalize headers (lowercase, trim)
    const normalizedHeaders = headers.map(h => 
      String(h).toLowerCase().trim().replace(/\s+/g, '_')
    );

    this.headerCache.set(sheetName, normalizedHeaders);
    return normalizedHeaders;
  }

  /**
   * Clear header cache for a sheet
   */
  clearHeaderCache(sheetName?: string): void {
    if (sheetName) {
      this.headerCache.delete(sheetName);
    } else {
      this.headerCache.clear();
    }
  }

  /**
   * Read all rows from a sheet
   */
  async readAll(sheetName: string): Promise<SheetRow[]> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    logger.debug(`Google Sheets: Reading all rows from '${sheetName}'`);
    
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`Google Sheets: Error reading '${sheetName}': ${errorMessage}`);
      throw error;
    }
    
    logger.debug(`Google Sheets: Got ${response.data.values?.length || 0} rows from '${sheetName}'`);

    const rows = response.data.values || [];
    if (rows.length < 2) return []; // No data rows (only headers or empty)

    const headers = await this.getHeaders(sheetName);
    const dataRows: SheetRow[] = [];

    // Start from row 1 (skip headers at row 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const values: Record<string, string> = {};

      for (let j = 0; j < headers.length; j++) {
        values[headers[j]] = String(row[j] ?? '');
      }

      dataRows.push({
        rowIndex: i + 1, // 1-indexed for Sheets API
        values,
      });
    }

    return dataRows;
  }

  /**
   * Read rows matching a filter
   */
  async readFiltered(
    sheetName: string,
    filter: (row: SheetRow) => boolean
  ): Promise<SheetRow[]> {
    const allRows = await this.readAll(sheetName);
    return allRows.filter(filter);
  }

  /**
   * Read a specific row by row index
   */
  async readRow(sheetName: string, rowIndex: number): Promise<SheetRow | null> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!${rowIndex}:${rowIndex}`,
    });

    const row = response.data.values?.[0];
    if (!row) return null;

    const headers = await this.getHeaders(sheetName);
    const values: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      values[headers[j]] = String(row[j] ?? '');
    }

    return { rowIndex, values };
  }

  /**
   * Append rows to the end of a sheet
   */
  async appendRows(
    sheetName: string,
    rows: Array<Record<string, string>>
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();
    const headers = await this.getHeaders(sheetName);

    // Convert row objects to arrays in header order
    const values = rows.map(row => 
      headers.map(header => row[header] ?? '')
    );

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    return response.data.updates?.updatedRows || 0;
  }

  /**
   * Update a specific row
   */
  async updateRow(
    sheetName: string,
    rowIndex: number,
    values: Record<string, string>
  ): Promise<void> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();
    const headers = await this.getHeaders(sheetName);

    // Convert row object to array in header order
    const rowValues = headers.map(header => values[header] ?? '');

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!${rowIndex}:${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] },
    });
  }

  /**
   * Update a specific cell
   */
  async updateCell(
    sheetName: string,
    rowIndex: number,
    column: string,
    value: string
  ): Promise<void> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();
    const headers = await this.getHeaders(sheetName);

    const colIndex = headers.indexOf(column.toLowerCase().trim().replace(/\s+/g, '_'));
    if (colIndex === -1) {
      throw new Error(`Column '${column}' not found in sheet '${sheetName}'`);
    }

    // Convert column index to letter (A, B, C, ... AA, AB, etc.)
    const colLetter = this.columnIndexToLetter(colIndex);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!${colLetter}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
  }

  /**
   * Batch update multiple cells
   */
  async batchUpdate(
    updates: Array<{
      sheetName: string;
      rowIndex: number;
      values: Record<string, string>;
    }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    // Group updates by sheet
    const updatesBySheet = new Map<string, typeof updates>();
    for (const update of updates) {
      const existing = updatesBySheet.get(update.sheetName) || [];
      existing.push(update);
      updatesBySheet.set(update.sheetName, existing);
    }

    // Build batch update data
    const data: sheets_v4.Schema$ValueRange[] = [];

    for (const [sheetName, sheetUpdates] of updatesBySheet) {
      const headers = await this.getHeaders(sheetName);

      for (const update of sheetUpdates) {
        const rowValues = headers.map(header => update.values[header] ?? '');
        data.push({
          range: `'${sheetName}'!${update.rowIndex}:${update.rowIndex}`,
          values: [rowValues],
        });
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });
  }

  /**
   * Find row by external ID
   */
  async findRowByExternalId(
    sheetName: string,
    externalIdField: string,
    externalId: string
  ): Promise<SheetRow | null> {
    const rows = await this.readFiltered(sheetName, row => 
      row.values[externalIdField] === externalId
    );
    return rows[0] || null;
  }

  /**
   * Upsert a row (update if exists, append if not)
   */
  async upsertRow(
    sheetName: string,
    externalIdField: string,
    values: Record<string, string>
  ): Promise<{ action: 'created' | 'updated'; rowIndex: number }> {
    const externalId = values[externalIdField];
    if (!externalId) {
      throw new Error(`External ID field '${externalIdField}' is missing from values`);
    }

    const existingRow = await this.findRowByExternalId(sheetName, externalIdField, externalId);

    if (existingRow) {
      // Merge with existing values (keep values not in the update)
      const mergedValues = { ...existingRow.values, ...values };
      await this.updateRow(sheetName, existingRow.rowIndex, mergedValues);
      return { action: 'updated', rowIndex: existingRow.rowIndex };
    } else {
      const rowsAppended = await this.appendRows(sheetName, [values]);
      // Get the new row index (approximate - better to use response data)
      const allRows = await this.readAll(sheetName);
      const newRow = allRows.find(r => r.values[externalIdField] === externalId);
      return { action: 'created', rowIndex: newRow?.rowIndex || allRows.length + 1 };
    }
  }

  /**
   * Delete a row (clear its contents)
   */
  async clearRow(sheetName: string, rowIndex: number): Promise<void> {
    const sheets = this.getClient();
    const spreadsheetId = this.getSpreadsheetId();

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sheetName}'!${rowIndex}:${rowIndex}`,
    });
  }

  /**
   * Convert column index (0-based) to letter
   */
  private columnIndexToLetter(index: number): string {
    let letter = '';
    while (index >= 0) {
      letter = String.fromCharCode((index % 26) + 65) + letter;
      index = Math.floor(index / 26) - 1;
    }
    return letter;
  }
}

// Export singleton instance
export const sheetsClient = new GoogleSheetsClient();
