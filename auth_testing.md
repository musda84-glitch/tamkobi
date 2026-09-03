# Auth Testing Playbook for NexusHesap

Step 1: MongoDB Verification
- Users collection has unique index on email
- Password hash uses bcrypt

Step 2: API Testing
- POST /api/auth/login with admin@nexus.com / admin123 -> returns token and user info
- GET /api/auth/me with Bearer token or cookie -> returns authenticated user profile
- POST /api/auth/logout -> clears session
