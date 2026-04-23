Pickleball FairPlay System

An automated, skill-balanced queuing system designed for pickleball facilities. It features a predictive matching algorithm, "Duo Linking" for partners, and a real-time synchronized TV display.

How to Run Locally

Follow these steps to get the system running on your machine:

1. Clone the repository:
   ```bash
   git clone [https://github.com/YOUR_USERNAME/pickleball-fairplay.git](https://github.com/YOUR_USERNAME/pickleball-fairplay.git)
   cd pickleball-fairplay
2. Install Dependencies: Make sure you have Node.js installed, then run:
    npm install
3. Start the Development Server:
    npm run dev
4. Access the App:
    Open your browser to the URL shown in your terminal (usually http://localhost:5173).
    Use the Admin toggle to manage players.
    Open the same URL in a second window and toggle to TV for a spectator-only view.

Features
Duo Linking: Link two players together; the algorithm will prioritize keeping them in the same match.

Skill Balancing: Uses a tolerance-expansion algorithm to ensure fair games while preventing long wait times.

Real-time Sync: Uses the BroadcastChannel API to sync the Admin and TV displays instantly across browser tabs.

Snooze/Rest: Allow players to take a break without losing their position in the games-played hierarchy.