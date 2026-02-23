const mongoose = require('mongoose');
require('dotenv').config('variables.env');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URL, {

        });
        console.log('Connected to MongoDB');
    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};

module.exports = connectDB;
