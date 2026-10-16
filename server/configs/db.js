import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        mongoose.connection.on('connected', () => {
            console.log('Database connected');
        });

        await mongoose.connect(process.env.MONGODB_URI);
    } catch (error) {
        console.log('MongoDB connection error:', error.message);
        throw error;
    }
};

export default connectDB;
