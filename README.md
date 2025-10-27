# 🏷️ EMRS – Event Management & Registration System

**EMRS (Event Management & Registration System)** is a complete digital solution built to simplify and automate event workflows — from attendee registration to on-site verification.  
It provides **online registration**, **QR-secured e-pass generation**, **real-time validation**, and **admin-level control** — all under one scalable, serverless architecture.

Designed for **single-event deployment**, EMRS can be easily reused for future events by resetting the database and updating configurations.  
The result: a secure, paperless, and efficient event experience for both organizers and attendees.

---

## 🚀 Key Features

### 📝 Online Registration
- User-friendly registration form for attendees to register quickly and securely.  
- Collects essential details: **Name**, **Phone Number**, **Email**, **City**, and **State**.  
- All data is validated and securely stored to prevent duplicates.

### 🎟️ Secure E-Pass Generation
- Automatically generates a **unique random Registration ID** (format: `UP25-XXXXXXXX`).  
- Creates a **QR-secured Digital E-Pass** containing:
  - Attendee details  
  - Profile image  
  - QR code encoding Registration ID & Phone Number  
- Includes a **“Download E-Pass”** option for easy access.

### ✉️ Automated Email Notifications
- Integrates **FormSubmit.co** to send personalized confirmation emails instantly.  
- Each email includes:
  - The attendee’s **E-Pass**  
  - **Registration details**  
  - A warm welcome message:  
    > “Thank you for registering — you are most welcome!”

### 🔍 Find My Pass
- Lets attendees **retrieve their E-Pass** anytime using their **registered email address**.  
- Ensures convenience if the original download is lost or deleted.

### 🔐 Verify & Check-In Page
- Enables event staff to validate attendees via:
  - **Web-based QR scanner**, or  
  - **Manual verification** (if QR scan fails).  
- Displays attendee details instantly upon scan or ID lookup.  
- Includes a **“Check-In”** button to mark attendance in real time.

### 🧭 Admin Dashboard
- Provides a centralized panel to **monitor, manage, and control** the entire system.  
- **Key Features:**
  - 📊 **Real-Time Monitoring:** Live stats of registrations & check-ins using **Netlify Functions**, **Neon DB**, and **Cloudinary APIs**.  
  - ⚙️ **System Health Status:** View running/down states of core services (Database, API, Cloudinary, etc.).  
  - 🚦 **Dynamic Registration Control:** Pause/resume registrations dynamically with live pop-up status updates.  
  - 🔧 **Maintenance Mode:** Temporarily disable the system during updates with a maintenance notice.  
  - 👥 **Manual Management:** Search, filter, and manage attendee records efficiently.

### ☁️ Serverless Architecture
- Built using the **Jamstack** approach for scalability, performance, and cost efficiency.  
- Combines **static hosting**, **serverless functions**, and **API-based workflows** for a fully cloud-driven experience.

---

## 🧠 Tech Stack

| Category | Technology / Tool | Purpose |
|-----------|-------------------|----------|
| **Frontend** | HTML, CSS, JavaScript | User interface & client interactions |
| **Backend** | Netlify Functions (Node.js) | Handles registration, verification, and logic |
| **Database** | PostgreSQL via **Neon DB** | Secure attendee data storage |
| **Database Client** | [`postgres.js`](https://github.com/porsager/postgres) | Lightweight Postgres client for Node.js |
| **Image Storage** | **Cloudinary** | Stores profile pictures & QR codes |
| **Email Service** | [FormSubmit.co](https://formsubmit.co/) | Sends confirmation & e-pass emails |
| **QR Code Generation** | [`qrcode`](https://www.npmjs.com/package/qrcode`) | Generates unique QR codes for passes |
| **Authentication** | `bcrypt`, `JWT` | Secure admin access and session control |
| **Deployment** | **Netlify** | Hosting + Serverless Functions |
| **Version Control** | **Git & GitHub** | Code management & collaboration |

---

## 🧩 System Overview

**EMRS** empowers event organizers with full control over every stage of the attendee journey — from registration to on-site management.  
By merging simplicity with security, EMRS eliminates paper-based processes and delivers a seamless digital event experience.

**Core Modules:**
1. 📝 Registration Page  
2. 🎟️ Verify & Check-In Page  
3. 🧭 Admin Dashboard  

---

## 🧑‍💻 Author

**Sarwan Yadav (Devsarwan)**  
Founder & CEO — [EllowDigital](https://ellowdigital.netlify.app)

- 🌐 [EllowDigital Official Website](https://ellowdigital.netlify.app)  
- 💼 [GitHub Organization – EllowDigital](https://github.com/EllowDigital)  
- 👤 [GitHub Profile – Devsarwan](https://github.com/devsarwan)

---

## 💬 Contact

For collaborations, inquiries, or demo requests:  
📧 **contact@ellowdigital.com**  
🌐 [www.ellowdigital.netlify.app](https://ellowdigital.netlify.app)

---

## 🪪 Copyright & License

**Copyright (c) 2025 [EllowDigital](https://github.com/EllowDigital)**  
All rights reserved.

This repository and its contents are provided for **demonstration and portfolio purposes only.**  
No part of this software — including code, design, or documentation — may be **used, copied, modified, merged, published, distributed, sublicensed, or sold** in any form without the **express written permission of EllowDigital.**  
Unauthorized use or reproduction of this material is **strictly prohibited.**

---

> 💡 *“EMRS is more than just registration — it’s a digital event experience that saves time, reduces paper, and enhances attendee engagement.”*
