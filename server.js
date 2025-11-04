// server.js

// Only load .env locally; Render injects env vars in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
  }
  
  const express = require('express');
  const mongoose = require('mongoose');
  
  const app = express();
  
  // Respect Render/Heroku-style port binding
  const port = process.env.PORT || 3000;
  
  // Basic health check for Render
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ message: 'OK', data: null });
  });
  
  // CORS (simple, permissive — fine for MP)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept'
    );
    res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    next();
  });
  
  // Built-in body parsers (no need for body-parser package on modern Express)
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  
  // Mount routes
  require('./routes')(app, express.Router());
  
  // ----- Mongo connection -----
  mongoose.Promise = global.Promise;
  
  const mongoUri = process.env.MONGODB_URI; // MUST be mongodb+srv://... from Atlas
  const dbName = process.env.MONGODB_DBNAME || 'mp3';
  
  if (!mongoUri) {
    console.warn(
      'Warning: MONGODB_URI is not set. API routes will fail until a connection string is provided.'
    );
  } else {
    (async () => {
      try {
        // With Mongoose 7+, no need for useNewUrlParser/useUnifiedTopology
        await mongoose.connect(mongoUri, { dbName });
        console.log('Mongo connected');
      } catch (err) {
        // Don’t print the full URI; keep logs clean of secrets
        console.error('MongoDB connection error:', err.message);
        // Optional: exit so Render restarts; comment out if you prefer the server to stay up
        // process.exit(1);
      }
    })();
  }
  
  // Start the server
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  
  // Export app for tests (harmless if unused)
  module.exports = app;
  