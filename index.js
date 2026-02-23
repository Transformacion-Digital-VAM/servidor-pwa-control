require('dotenv').config({ path: 'variables.env' });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const app = express();
const userRoutes = require('./routes/user.routes');
// Conectar a la base de datos
connectDB();

// Middleware
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/users', userRoutes);

// Iniciar el servidor
app.listen(3000, () => console.log('Server online: http://localhost:3000'));