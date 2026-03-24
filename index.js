const fs = require('fs');
const path = require('path');

// Cargar variables de entorno localmente si el archivo existe
if (fs.existsSync('variables.env')) {
  require('dotenv').config({ path: 'variables.env' });
} else {
  require('dotenv').config(); // Intentar cargar .env por defecto o usar las de Render
}

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const app = express();
const userRoutes = require('./routes/user.routes');
const grupoRoutes = require('./routes/grupo.router');
const miembroRoutes = require('./routes/miembro.routes');
const clienteRoutes = require('./routes/cliente.router');
const creditoRoutes = require('./routes/credito.router');
// Conectar a la base de datos
connectDB();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/users', userRoutes);
app.use('/api/grupos', grupoRoutes);
app.use('/api/miembros', miembroRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/creditos', creditoRoutes);

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server online on port ${PORT}`);
});