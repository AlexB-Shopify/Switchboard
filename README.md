# Switchboard

**Switchboard** is a simple integration layer between Shopify and your back office systems. It keeps your store in sync with various sources of truth for Products, Inventory, Orders, Fulfillments, Catalogs, Content, Discounts, Gift Cards, and Customer Data.

## Features

- **Bidirectional Sync**: Configure each data object to sync TO Shopify, FROM Shopify, or bidirectionally
- **Flexible Triggers**: Cron-based scheduled syncs or webhook-driven real-time updates
- **Demo & Production Modes**: Compressed timelines for demos, standard intervals for production
- **Non-Destructive**: Works safely with existing stores via configurable `existingDataBehavior`
- **Modular Architecture**: Easy to add new integrations or data sources
- **Human-Readable Logs**: Clear sync summaries and error messages

## Quick Start

### Prerequisites

- Node.js 18+
- A Shopify store with Admin API access (via Dev Dashboard app)
- A Google Spreadsheet (acting as your "ERP")

### Installation

```bash
# Clone the repository
cd switchboard

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Configuration

1. **Shopify Setup**
   - Create an app in [Shopify Dev Dashboard](https://dev.shopify.com/dashboard)
   - Configure required scopes and install on your store
   - Copy Client ID and Client Secret to `.env`

Scopes to include:
   ```bash
read_customers,write_customers,read_price_rules,write_price_rules,read_discounts,write_discounts,read_fulfillments,write_fulfillments,read_gift_cards,write_gift_cards,write_inventory,read_inventory,write_locations,read_locations,read_markets,write_markets,read_metaobjects,write_metaobjects,read_orders,write_orders,read_products,write_products
```

Creating a tunnel:
- Utilize an appropriate tunneling software to create a local tunnel that the server can use to route webhooks to (i.e. Dev, Ngrok, Cloudflare)
- Add this created URL to your .env file as WEBHOOK_BASE_URL

2. **Google Sheets Setup**
   - Create a spreadsheet following the template in `erp-template/README.md`
   - Set up authentication (see Google Sheets Authentication section)
   - Copy the Spreadsheet ID to `.env`

3. **Edit Configuration**
   - Review `config/switchboard.yaml` for sync settings
   - Enable/disable data objects as needed
   - Adjust schedules for your use case

### Running

```bash
# Start in demo mode (compressed timelines, resets database)
npm run start:demo

# Start in production mode
npm run start:prod

# Or use CLI directly
npx ts-node src/index.ts --demo
npx ts-node src/index.ts --production
```

### Manual Sync

```bash
# Trigger a sync for a specific data object
npx ts-node src/index.ts sync products --demo
npx ts-node src/index.ts sync inventory --demo
```

### Check Status

```bash
npx ts-node src/index.ts status --demo
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Switchboard Daemon                          │
├─────────────────────────────────────────────────────────────────┤
│  CLI Entry Point → Config Manager → Job Scheduler               │
│                                    ↓                            │
│  Webhook Server ──────────────→ Job Queue                       │
│                                    ↓                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Data Object Handlers                    │   │
│  │  Products │ Inventory │ Orders │ Fulfillments │ ...      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          ↓           ↓                          │
│  ┌──────────────────┐  ┌──────────────────────────────────┐    │
│  │  SQLite Database │  │         Integrations             │    │
│  │  (Prisma ORM)    │  │  Shopify API │ Google Sheets     │    │
│  └──────────────────┘  └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

The main configuration file is `config/switchboard.yaml`. Each data object supports:

| Setting | Description |
|---------|-------------|
| `enabled` | Toggle sync on/off |
| `direction` | `to_shopify`, `from_shopify`, or `bidirectional` |
| `trigger` | `cron` or `webhook` |
| `schedule` | Cron expressions for production and demo modes |
| `mode` | `sync` (smart) or `overwrite` (full replace) |
| `existingDataBehavior` | How to handle pre-existing Shopify data |
| `dependencies` | Other objects that must sync first |

### Existing Data Behavior

Controls how Switchboard handles data that already exists in Shopify:

| Value | Behavior |
|-------|----------|
| `ignore` (default) | Only manage items created by Switchboard |
| `adopt` | Match existing items by SKU/external ID and manage them |
| `adopt_and_archive` | Same as adopt, but archive unmatched items |

## Data Objects

| Object | Default Direction | Default Trigger | Description |
|--------|-------------------|-----------------|-------------|
| Products | to_shopify | cron | Sync product catalog |
| Inventory | to_shopify | cron | Sync inventory levels |
| Orders | from_shopify | webhook | Receive orders in ERP |
| Fulfillments | to_shopify | cron | Send fulfillments to Shopify |
| Catalogs | to_shopify | cron | Manage B2B catalogs |
| Metaobjects | to_shopify | cron | Sync custom content |
| Discounts | to_shopify | cron | Manage discount codes |
| Gift Cards | bidirectional | cron | Sync gift cards both ways |
| Customers | from_shopify | webhook | Receive customers in ERP |

## Environment Variables

```bash
# Shopify Configuration
SHOPIFY_STORE_DOMAIN="your-store"
SHOPIFY_CLIENT_ID="your-client-id"
SHOPIFY_CLIENT_SECRET="your-client-secret"
SHOPIFY_API_VERSION="2026-01"

# Google Sheets Configuration
GOOGLE_SHEETS_SPREADSHEET_ID="your-spreadsheet-id"
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"

# Webhook Server
WEBHOOK_PORT=3000
WEBHOOK_SECRET="your-webhook-secret"
WEBHOOK_BASE_URL="https://your-ngrok-url.ngrok.io"

# Database
DATABASE_URL="file:./prisma/switchboard.db"

# Mode (can be overridden by CLI)
MODE="demo"
```

## Webhooks

For real-time sync (Orders, Customers), Switchboard needs to receive webhooks from Shopify.

### Local Development

1. Install [ngrok](https://ngrok.com/)
2. Start ngrok: `ngrok http 3000`
3. Set `WEBHOOK_BASE_URL` to your ngrok URL
4. Start Switchboard - it will auto-register webhooks

### Production

Deploy Switchboard to a publicly accessible server and set `WEBHOOK_BASE_URL` to your server URL.

## Logging

Switchboard uses human-readable structured logging:

```
[2026-02-03 10:15:32] [INFO ] Sync started
[2026-02-03 10:15:35] [INFO ] [products] 15 processed: 12 synced, 2 unchanged, 1 failed
[2026-02-03 10:15:35] [ERROR] [products] SKU-123: Failed - Title is required
[2026-02-03 10:15:35] [INFO ] [products] Sync completed in 3.2s
```

## Development

```bash
# Run with auto-reload
npm run dev

# Generate Prisma client after schema changes
npm run db:generate

# Run migrations
npm run db:migrate

# Reset database
npm run db:reset
```

## License

ISC
