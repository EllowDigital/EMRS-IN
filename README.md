# 🏷️ EMRS – Event Management and Registration System

**EMRS (Event Management and Registration System)** is an end-to-end digital platform designed to simplify and automate event operations.  
It enables seamless **online registration**, **secure digital e-pass generation**, **real-time attendee validation**, and **QR-based check-ins**.  
The system also features an **admin dashboard** for complete event oversight, with controls to pause registrations, track stats, and manage attendees — all while ensuring a smooth, paperless experience.

This repository is built for **single-event deployment** and can be easily reused for future events by resetting the database and updating configuration details.

---

## 🚀 Key Features

- **Online Attendee Registration:** A user-friendly registration form for attendees to register quickly and securely.  
- **Secure E-Pass Generation:** Generates a unique, QR-secured digital e-pass containing attendee details and profile image.  
- **Real-Time Validation & Check-In:** Admins can validate attendees by scanning QR codes (camera-based) or through manual check-in.  
- **Admin Dashboard:**  
  - Monitor real-time registration and check-in statistics.  
  - Pause or resume registrations dynamically.  
  - Activate “maintenance mode” for system updates.  
  - Search and manage attendees manually.  
- **Automated Email Notifications:**  
  Utilizes **FormSubmit.co** to send personalized confirmation emails, including the attendee’s e-pass and details, along with a warm message:  
  *“Thank you for registering — you are most welcome!”*  
- **Find My Pass:** Allows attendees to retrieve their e-pass using their registered email.  
- **Serverless Architecture:**  
  Designed for scalability and cost efficiency using the **Jamstack** model — combining static hosting, serverless functions, and API-based workflows.

---

## 🧠 Tech Stack

- **Frontend:** HTML, CSS, and Vanilla JavaScript  
- **Backend:** Serverless (Netlify Functions running Node.js)  
- **Database:** PostgreSQL (hosted on **Neon DB**)  
- **Database Client:** [`postgres.js`](https://github.com/porsager/postgres) – lightweight Postgres client for Node.js  
- **Image & Asset Management:** Cloudinary (for storing attendee photos and QR codes)  
- **Email Notifications:** [FormSubmit.co](https://formsubmit.co/) for sending confirmation and e-pass emails  
- **QR Code Generation:** [`qrcode`](https://www.npmjs.com/package/qrcode) npm library  
- **Authentication:** `bcrypt` for password hashing and `JWT` for secure admin sessions  
- **Deployment:** Netlify (hosting + serverless functions)  
- **Version Control:** Git & GitHub  

---

## 🧩 Project Overview

**EMRS** delivers a unified event management solution tailored for organizers who want full control over registration, verification, and attendee engagement.  
With integrated digital passes, live tracking, and an intuitive dashboard, EMRS bridges convenience and security for modern event operations.

---

## 👨‍💻 Author

**Sarwan Yadav (Devsarwan)**  
Founder & CEO — [EllowDigital](https://ellowdigital.netlify.app)  

- 🌐 [EllowDigital Official Website](https://ellowdigital.netlify.app)  
- 💼 [GitHub Organization – EllowDigital](https://github.com/EllowDigital)  
- 👤 [GitHub Profile – Devsarwan](https://github.com/devsarwan)  

---

## 💬 Contact

For collaborations, inquiries, or project demos:  
📧 **contact@ellowdigital.com**  
🌐 [www.ellowdigital.netlify.app](https://ellowdigital.netlify.app)
