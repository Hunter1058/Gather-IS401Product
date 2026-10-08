# Gather-IS401Product

# App Summary:

We identified a group of people similar to Kaleb who want to go to more campus and local activities and events.
Oftentimes, people like Kaleb are only willing to go to activities if it meets certain criteria (has food, if friends want/can).
Additionally, it can be hard for Caleb and his friends to find relevant activities, their locations, time, and other information about the events
since they are often posted in a plethora of different sites and physical advertisements.

# ERD: 
<img width="1710" height="1107" alt="Screenshot 2026-10-07 at 3 57 01 PM" src="https://github.com/user-attachments/assets/b8ab864f-8352-45f6-9083-1221c3c2c010" />

# Techstack:

- **HTML** – Structures the website and its content.
- **CSS** – Handles styling, layout, and responsive design.
- **JavaScript** – Adds interactivity and manages frontend logic.
- **Node.js** – Handles backend logic and server-side functionality.
- **Supabase** – Provides the PostgreSQL database, authentication, and backend services.

This stack fits our team because it uses familiar web technologies, keeps development simple, and gives us the tools needed to build both the frontend and backend without unnecessary complexity.


# How to Get It Running:

- Download the files
- Run npm install inside the terminal to ensure everythings downloaded
- Create a supabase and run schema.sql and seed.sql inside the SQL Editor on Supabase
- create a local .env file within the main folder
- create 2 keys "SUPABASE_URL = 'SUPABASE URL' and SUPABASE_KEY = 'SUPABASE PUBLICATION KEY URL'
- this connects the site to your supabase

- run "node --env-file=.env server.js" in terminal to start the site locally in "SUPABASE Mode"
- It should be running locally now! :)

# Verifying the Vertical Slice: How to trigger your working button and confirm the change survives a page refresh.

- Click the sign in button in the top right corner of the screen
- Select the create a new account option
- Create your account
- Once the account is created, refresh your page
- You should still be signed in
- If you log out and refresh your page you should also be able to log back in regardless of the page refresh


