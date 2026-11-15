# RTBI Portal

The official enterprise portal for the **Ramaiah Technology Business Incubator (RTBI)**. Built with Next.js 16 (App Router), React 19, TypeScript, and Tailwind CSS, backed by an AES-256-GCM encrypted file datastore.

---

## 🔒 Security Posture: Zero-Trust, Zero-Access Policy (Active)

> [!IMPORTANT]
> **Site-wide Zero-Trust, Zero-Access user policy is currently enforced.**
>
> To ensure maximum data integrity and security while modules, workflows, and database models are being actively developed and tested:
> - **Super User (Tier 1):** Holds sole access to all models, collections, configuration, and controls site-wide.
> - **All Other Roles (CEO Tier 2, Employee Tier 3, Startup Tier 4):** Are locked out with **Zero Access** across all dashboard modules and API routes.
> - Non-super-user accounts attempting to access portal modules see a dedicated `Zero-Trust Access Restricted` interface and all protected server API endpoints reject non-super users with `403 Forbidden`.
> - **Future Rollout:** Granular view/edit permissions, startup self-service workflows, and departmental capabilities will be provisioned progressively as each module reaches production readiness.

---

## 🏢 Four-Tier Role Architecture

The portal is designed around a top-down hierarchy:

| Tier | Role | Current Status | Description |
| :---: | :--- | :--- | :--- |
| **1** | **Super User** | **Full Access** | System administrator with complete control over all data models, security, and settings. |
| **2** | **CEO** | Zero Access (Pending) | Executive leadership oversight, approvals, and high-level reporting. |
| **3** | **Employee** | Zero Access (Pending) | Incubator staff managing events, task deliverables, inventory, and operations. |
| **4** | **Startup** | Zero Access (Pending) | Incubated startup founders reserving facilities (Boardroom/Meeting Room), accessing services, and viewing invoices. |

---

## 🛠️ Core Capabilities & Modules

- **Room Bookings & Facilities:** Dedicated reservations for the **Boardroom** (14 seats) and **Meeting Room** (6 seats) with conflict prevention and live calendar sync.
- **Calendar & Master Schedule:** Consolidated tracking of symposiums, workshops, milestones, task deadlines, and live room bookings.
- **Event Passes & Digital Wallet:** 3D interactive keycards, turnstile QR gate scanning, and Apple / Google Wallet pass integration.
- **Certificates Studio:** Attendance certificate designer, custom font support, and automated bulk issuance.
- **Billing & Inventory:** Automatic invoice generation, GST calculations, payment verification, and stock movement logs.
- **AES-256-GCM Storage:** Zero external database dependency; per-collection encrypted JSON storage at `data/*.json` with secure salt and key derivation.

---

## 🚀 Getting Started

### 1. Installation & Local Development
```bash
# Install dependencies
npm install

# Start local server (defaults to port 3030)
npm run dev
```

Visit [http://localhost:3030](http://localhost:3030) in your browser.

### 2. First-Time Setup
If starting with fresh storage, run the interactive setup script or visit `/setup`:
```bash
npm run setup
```
This initializes the encrypted datastore, generates `DATA_ENCRYPTION_KEY` in `.env`, and creates the root **Super User** account.

> [!WARNING]
> Keep your `DATA_ENCRYPTION_KEY` backed up securely. Without it, the encrypted collections in `data/` cannot be decrypted.

---

## 🧪 Verification & Build
```bash
# Type check without emitting files
npx tsc --noEmit

# Optimized production build
npm run build
```
