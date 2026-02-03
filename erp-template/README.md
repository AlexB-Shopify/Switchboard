# Google Sheets ERP Template

This document describes the expected structure for your Google Sheets "ERP" spreadsheet that Switchboard uses to sync data with Shopify.

## Setup Instructions

1. Create a new Google Spreadsheet
2. Create the following sheets (tabs) with the exact names and headers listed below
3. Copy the Spreadsheet ID from the URL (the long string between `/d/` and `/edit`)
4. Set the `GOOGLE_SHEETS_SPREADSHEET_ID` environment variable

## Sheet Structures

### Products Sheet

**Sheet Name:** `Products`

| Column | Description | Required |
|--------|-------------|----------|
| sku | Unique SKU identifier | Yes |
| title | Product title | Yes |
| description | Product description (HTML supported) | No |
| vendor | Product vendor | No |
| product_type | Product type/category | No |
| tags | Comma-separated tags | No |
| status | `active`, `draft`, or `archived` | No (default: active) |
| price | Product price | No (default: 0.00) |
| shopify_id | Shopify product ID (auto-filled) | No |

**Example:**
```
sku,title,description,vendor,product_type,tags,status,price,shopify_id
SKU-001,Blue Widget,A beautiful blue widget,WidgetCo,Widgets,"blue,widget",active,29.99,
SKU-002,Red Widget,A vibrant red widget,WidgetCo,Widgets,"red,widget",active,29.99,
```

---

### Inventory Sheet

**Sheet Name:** `Inventory`

| Column | Description | Required |
|--------|-------------|----------|
| sku | Product SKU (must match Products sheet) | Yes |
| location | Location name (optional, uses default if empty) | No |
| quantity | Inventory quantity | Yes |
| shopify_id | Shopify inventory item ID (auto-filled) | No |

**Example:**
```
sku,location,quantity,shopify_id
SKU-001,Main Warehouse,100,
SKU-001,Retail Store,25,
SKU-002,Main Warehouse,50,
```

---

### Orders Sheet

**Sheet Name:** `Orders`

This sheet is **read-only** - data flows FROM Shopify TO the sheet via webhooks.

| Column | Description |
|--------|-------------|
| order_number | Shopify order number (e.g., #1001) |
| email | Customer email |
| total | Order total with currency |
| financial_status | Payment status |
| fulfillment_status | Fulfillment status |
| created_at | Order creation timestamp |
| line_items | Formatted line items |
| customer_name | Customer name |
| shopify_id | Shopify order GID |

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

**Example:**
```
order_number,tracking_number,tracking_company,status,shopify_id
#1001,1Z999AA10123456784,UPS,ready,
#1002,9400111899223456789012,USPS,ready,
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

**Example:**
```
name,market,product_skus,shopify_id
Summer Collection,US,SKU-001,SKU-002,
B2B Catalog,Wholesale,"SKU-001,SKU-002,SKU-003",
```

---

### Content Sheet (Metaobjects)

**Sheet Name:** `Content`

Dynamic columns based on your metaobject definition.

| Column | Description | Required |
|--------|-------------|----------|
| handle | Unique handle for the metaobject | Yes |
| type | Metaobject definition handle | No (uses config default) |
| *field_name* | Any metaobject field | Depends on definition |
| shopify_id | Shopify metaobject ID (auto-filled) | No |

**Example (for a "custom_content" definition with title and body fields):**
```
handle,type,title,body,shopify_id
homepage-banner,custom_content,Summer Sale!,Save up to 50% on summer items,
about-us,custom_content,About Our Company,We've been making widgets since 1999,
```

---

### Discounts Sheet

**Sheet Name:** `Discounts`

| Column | Description | Required |
|--------|-------------|----------|
| code | Discount code | Yes |
| title | Discount title | No |
| type | `percentage` or `fixed` | Yes |
| value | Discount value (e.g., 10 for 10% or 10.00 for $10) | Yes |
| starts_at | Start date (ISO format) | Yes |
| ends_at | End date (ISO format) | No |
| shopify_id | Shopify discount ID (auto-filled) | No |

**Example:**
```
code,title,type,value,starts_at,ends_at,shopify_id
SUMMER20,Summer Sale,percentage,20,2026-06-01T00:00:00Z,2026-08-31T23:59:59Z,
FLAT10,Flat $10 Off,fixed,10.00,2026-01-01T00:00:00Z,,
```

---

### GiftCards Sheet

**Sheet Name:** `GiftCards`

| Column | Description | Required |
|--------|-------------|----------|
| code | Gift card code (optional - Shopify can generate) | No |
| initial_value | Initial gift card value | Yes |
| balance | Current balance (auto-updated from Shopify) | No |
| note | Internal note | No |
| shopify_id | Shopify gift card ID (auto-filled) | No |

**Example:**
```
code,initial_value,balance,note,shopify_id
GIFT-001,50.00,,Holiday promo,
GIFT-002,100.00,,VIP customer,
```

---

### Customers Sheet

**Sheet Name:** `Customers`

This sheet is **read-only** - data flows FROM Shopify TO the sheet via webhooks.

| Column | Description |
|--------|-------------|
| email | Customer email |
| first_name | First name |
| last_name | Last name |
| phone | Phone number |
| addresses | Formatted addresses |
| shopify_id | Shopify customer GID |

---

## Notes

1. **Headers are case-insensitive** - `SKU`, `Sku`, and `sku` are all valid
2. **Spaces in headers** are converted to underscores (e.g., "Product Type" → "product_type")
3. **shopify_id columns** are automatically populated by Switchboard after successful sync
4. **Empty rows** are skipped during sync
5. **Duplicate SKUs** in the same sheet will use the last occurrence
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
