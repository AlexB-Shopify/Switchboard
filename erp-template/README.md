# Google Sheets ERP Template

This document describes the expected structure for your Google Sheets "ERP" spreadsheet that Switchboard uses to sync data with Shopify.

## Setup Instructions

1. Create a new Google Spreadsheet
2. Create the following sheets (tabs) with the exact names and headers listed below
3. Copy the Spreadsheet ID from the URL (the long string between `/d/` and `/edit`)
4. Set the `GOOGLE_SHEETS_SPREADSHEET_ID` environment variable

## Compatibility

Switchboard supports **two formats** for most sheets:

1. **Simplified ERP Format** - Minimal columns for easy manual editing
2. **Shopify Export Format** - Direct import of Shopify CSV exports

You can mix formats or use Shopify exports directly as your data source.

---

## Sheet Structures

### Products Sheet

**Sheet Name:** `Products`

Switchboard supports multi-variant products. Each variant is a separate row, grouped by `Handle`.

#### Simplified ERP Format

| Column | Description | Required |
|--------|-------------|----------|
| handle | URL-friendly product identifier | Yes |
| sku | Unique SKU identifier | No |
| title | Product title | Yes |
| description | Product description (HTML supported) | No |
| vendor | Product vendor | No |
| product_type | Product type/category | No |
| tags | Comma-separated tags | No |
| status | `active`, `draft`, or `archived` | No (default: active) |
| price | Variant price | No (default: 0.00) |
| image_url | Product image URL | No |
| option1_name | First option name (e.g., "Size") | No |
| option1_value | First option value (e.g., "Small") | No |
| shopify_id | Shopify product ID (auto-filled) | No |

#### Shopify Export Format (Full Compatibility)

The following columns from Shopify product exports are supported:

| Column | Description |
|--------|-------------|
| Handle | Product handle (URL-friendly identifier) |
| Title | Product title |
| Body (HTML) | Product description |
| Vendor | Product vendor |
| Type | Product type |
| Tags | Comma-separated tags |
| Published | Whether product is published |
| Option1 Name | First option name (e.g., "Color") |
| Option1 Value | First option value (e.g., "Red") |
| Option2 Name | Second option name |
| Option2 Value | Second option value |
| Option3 Name | Third option name |
| Option3 Value | Third option value |
| Variant SKU | SKU for this variant |
| Variant Price | Price for this variant |
| Variant Compare At Price | Compare at price |
| Variant Grams | Weight in grams |
| Variant Weight Unit | Weight unit (kg, lb, etc.) |
| Variant Barcode | Barcode |
| Image Src | Main product image URL |
| Variant Image | Variant-specific image URL |
| Status | Product status (active/draft/archived) |

**Multi-Variant Example:**
```
Handle,Title,Body (HTML),Vendor,Option1 Name,Option1 Value,Variant Price,Status
clay-vase,Clay Vase,"<p>Beautiful handcrafted vase</p>",Omni,Size,Small,449.00,active
clay-vase,,,,Size,Medium,549.00,
clay-vase,,,,Size,Large,649.00,
```

Note: For multi-variant products, only the first row needs product-level data (Title, Description, etc.). Subsequent rows for the same Handle only need variant-specific data.

---

### Inventory Sheet

**Sheet Name:** `Inventory`

#### Simplified ERP Format

| Column | Description | Required |
|--------|-------------|----------|
| handle | Product handle | Yes (or sku) |
| sku | Product SKU | Yes (or handle) |
| option1_value | Variant option value for matching | No |
| location | Location name | No (uses default) |
| quantity | Inventory quantity to set | Yes |
| shopify_id | Shopify inventory item ID (auto-filled) | No |

#### Shopify Export Format

| Column | Description |
|--------|-------------|
| Handle | Product handle |
| Title | Product title |
| Option1 Name | Option name (e.g., "Size") |
| Option1 Value | Option value (e.g., "Small") |
| Option2 Name/Value | Second option |
| Option3 Name/Value | Third option |
| SKU | Variant SKU |
| HS Code | Harmonized System code |
| COO | Country of Origin |
| Location | Location name |
| Bin name | Bin/shelf location |
| On hand (new) | Quantity to set (editable field) |
| Available (not editable) | Available quantity (read-only) |
| Committed (not editable) | Committed quantity (read-only) |

**Example:**
```
Handle,Title,Option1 Name,Option1 Value,SKU,Location,On hand (new)
clay-vase,Clay Vase,Size,Small,,Main Warehouse,46
clay-vase,Clay Vase,Size,Medium,,Main Warehouse,7
clay-vase,Clay Vase,Size,Large,,Main Warehouse,159
```

---

### Orders Sheet

**Sheet Name:** `Orders`

This sheet is **read-only** - data flows FROM Shopify TO the sheet via webhooks.

Each line item is written as a separate row (matching Shopify export format).

| Column | Description |
|--------|-------------|
| Name | Order name (e.g., #1001) |
| Email | Customer email |
| Financial Status | Payment status |
| Fulfillment Status | Fulfillment status |
| Currency | Order currency |
| Subtotal | Subtotal amount |
| Shipping | Shipping amount |
| Taxes | Tax amount |
| Total | Total amount |
| Discount Code | Applied discount code |
| Created at | Order creation timestamp |
| Lineitem quantity | Quantity of this line item |
| Lineitem name | Product name with variant |
| Lineitem price | Price of this line item |
| Lineitem sku | SKU of this line item |
| Lineitem fulfillment status | Fulfillment status of line item |
| Billing Name | Billing address name |
| Billing Address1 | Billing street address |
| Billing City | Billing city |
| Billing Province | Billing state/province |
| Billing Country | Billing country |
| Shipping Name | Shipping address name |
| Shipping Address1 | Shipping street address |
| Shipping City | Shipping city |
| Shipping Province | Shipping state/province |
| Shipping Country | Shipping country |
| Vendor | Line item vendor |
| Id | Shopify order ID |
| Tags | Order tags |

---

### Fulfillments Sheet

**Sheet Name:** `Fulfillments`

| Column | Description | Required |
|--------|-------------|----------|
| order_number | Order number to fulfill (e.g., #1001) | Yes |
| tracking_number | Tracking number | No |
| tracking_company | Carrier name (e.g., USPS, FedEx) | No |
| status | Fulfillment status | Yes |
| shopify_id | Shopify fulfillment ID (auto-filled) | No |

**Status Values:**
- `pending` - Not yet processed
- `ready` - Ready to fulfill (Switchboard will process this)
- `synced` - Successfully synced to Shopify
- `error` - Failed to sync

---

### Discounts Sheet

**Sheet Name:** `Discounts`

#### Simplified ERP Format

| Column | Description | Required |
|--------|-------------|----------|
| code | Discount code | Yes |
| title | Discount title | No |
| type | `percentage` or `fixed` | Yes |
| value | Discount value | Yes |
| starts_at | Start date (ISO format) | Yes |
| ends_at | End date (ISO format) | No |
| shopify_id | Shopify discount ID (auto-filled) | No |

#### Shopify Export Format

| Column | Description |
|--------|-------------|
| Name | Discount code |
| Value | Discount value (negative, e.g., -20.0) |
| Value Type | `percentage` or `fixed_amount` |
| Type | Discount type |
| Discount Class | `product`, `order`, etc. |
| Start | Start date |
| End | End date |
| Status | Active/Inactive |

**Example (ERP Format):**
```
code,title,type,value,starts_at,ends_at,shopify_id
SUMMER20,Summer Sale,percentage,20,2026-06-01T00:00:00Z,2026-08-31T23:59:59Z,
```

---

### GiftCards Sheet

**Sheet Name:** `GiftCards`

**IMPORTANT: Gift Card Code Handling**

- **To CREATE new gift cards**: Provide the FULL code in the `code` column, OR leave it blank and Shopify will generate one (the generated code will be written back to your sheet!)
- **Shopify exports** only provide `Last Characters` (last 4 digits) - these cards are **READ-ONLY** for balance sync purposes since the full code cannot be recovered
- Gift card codes are typically 16-20 characters long

#### Simplified ERP Format (for creating new cards)

| Column | Description | Required |
|--------|-------------|----------|
| code | Full gift card code (16+ chars, or leave blank to auto-generate) | No |
| initial_value | Initial gift card value | Yes |
| balance | Current balance (auto-updated from Shopify) | No |
| note | Internal note | No |
| shopify_id | Shopify gift card ID (auto-filled) | No |

**Example (Creating new cards):**
```
code,initial_value,balance,note,shopify_id
MYCODE123456789A,50.00,,Holiday promo,
,100.00,,VIP customer (code will be auto-generated),
```

After sync, the auto-generated codes are written back to the sheet so you have a record.

#### Shopify Export Format (read-only for balance sync)

| Column | Description |
|--------|-------------|
| Id | Shopify gift card ID (numeric) |
| Last Characters | Last 4 characters of code (NOT usable for creation) |
| Customer Name | Customer name |
| Email | Customer email |
| Recipient Name | Recipient name |
| Recipient Email | Recipient email |
| Order Name | Associated order |
| Date Issued | Issue date |
| Send At | Scheduled send date |
| Expires On | Expiration date |
| Initial Balance | Initial value |
| Current Balance | Current balance |
| Currency | Currency code |
| Expired? | Whether card is expired |
| Enabled? | Whether card is enabled |
| Note | Internal note |
| Message | Gift card message |

**Example (Shopify Export - balances sync down, but cannot create new cards):**
```
Id,Last Characters,Initial Balance,Current Balance,Currency,Note
669632561443,3rqb,100.00,85.00,CAD,""
```

---

### Catalogs Sheet

**Sheet Name:** `Catalogs`

| Column | Description | Required |
|--------|-------------|----------|
| name | Catalog name | Yes |
| market | Market name to associate with | No |
| product_skus | Comma-separated product SKUs | No |
| shopify_id | Shopify catalog ID (auto-filled) | No |

---

### Content Sheet (Metaobjects)

**Sheet Name:** `Content`

**IMPORTANT: Metaobject definitions must be pre-created in Shopify!**

Before using this sheet, you must:
1. Go to **Shopify Admin** → **Settings** → **Custom data** → **Metaobjects**
2. Create a new metaobject definition with:
   - A **type handle** (e.g., `brand_story`, `faq_item`, `testimonial`)
   - **Fields** with their types (single_line_text, multi_line_text, rich_text, url, etc.)
3. Note the field **keys** - these become your column names

Your sheet columns must match the field keys from your metaobject definition.

| Column | Description | Required |
|--------|-------------|----------|
| handle | Unique handle for the metaobject entry | Yes |
| type | Metaobject definition handle (e.g., `brand_story`) | No (uses config default) |
| *field_key* | Columns matching your metaobject field keys | Depends on definition |
| shopify_id | Shopify metaobject ID (auto-filled) | No |

**Example: FAQ Metaobject**

First, create in Shopify a metaobject definition called `faq_item` with fields:
- `question` (single_line_text)
- `answer` (multi_line_text)
- `category` (single_line_text)

Then your sheet would be:
```
handle,type,question,answer,category,shopify_id
shipping-faq,faq_item,How long does shipping take?,Standard shipping is 5-7 business days.,Shipping,
returns-faq,faq_item,What is your return policy?,30-day returns on all items.,Returns,
```

**Config setting:**
```yaml
metaobjects:
  settings:
    definitionHandle: "faq_item"  # Default type if not specified in sheet
```

---

### Customers Sheet

**Sheet Name:** `Customers`

This sheet is **read-only** - data flows FROM Shopify TO the sheet via webhooks.

Switchboard writes customer data in Shopify export format for easy comparison and re-import.

| Column | Description |
|--------|-------------|
| Customer ID | Shopify customer ID (numeric) |
| First Name | Customer first name |
| Last Name | Customer last name |
| Email | Customer email address |
| Accepts Email Marketing | `yes` or `no` |
| Default Address Company | Company name |
| Default Address Address1 | Street address line 1 |
| Default Address Address2 | Street address line 2 |
| Default Address City | City |
| Default Address Province Code | State/province code (e.g., ON, CA) |
| Default Address Country Code | Country code (e.g., US, CA) |
| Default Address Zip | Postal/ZIP code |
| Default Address Phone | Address phone number |
| Phone | Customer phone number |
| Accepts SMS Marketing | `yes` or `no` |
| Total Spent | Total amount spent |
| Total Orders | Number of orders |
| Note | Customer notes |
| Tax Exempt | `yes` or `no` |
| Tags | Customer tags |

**Example:**
```
Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Address1,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Total Spent,Total Orders,Tags
'9013808660771,Jamel,Crooks,jamel.crooks@example.com,no,88799 Roosevelt Shoal,Port Erin,,CA,T1H 2R5,997.98,1,VIP
```

Note: Customer ID is prefixed with `'` to prevent spreadsheet number formatting issues.

---

## Notes

1. **Headers are case-insensitive** - `SKU`, `Sku`, and `sku` are all valid
2. **Flexible column names** - Switchboard recognizes various column name formats:
   - Shopify export names: `Body (HTML)`, `Option1 Value`, `On hand (new)`
   - Simplified names: `description`, `option1_value`, `quantity`
   - With/without underscores: `product_type` = `producttype`
3. **Multi-variant products** use multiple rows with the same `Handle`
4. **shopify_id columns** are automatically populated by Switchboard
5. **Empty rows** are skipped during sync
6. **Date formats** should be ISO 8601 (e.g., `2026-01-15T10:30:00Z`)

## Google Sheets Authentication

For Switchboard to access your spreadsheet, you need to set up authentication:

### Option 1: Service Account (Recommended for Production)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the Google Sheets API
4. Create a Service Account
5. Download the JSON key file
6. Share your spreadsheet with the service account email
7. Set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`

### Option 2: API Key (Read-Only, Good for Testing)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create an API key
3. Restrict it to Google Sheets API
4. Make your spreadsheet publicly viewable (or use service account)
5. Set `GOOGLE_SHEETS_API_KEY=your-api-key`

### Option 3: Application Default Credentials (Development)

1. Install [gcloud CLI](https://cloud.google.com/sdk/docs/install)
2. Run `gcloud auth application-default login`
3. Switchboard will automatically use your credentials
