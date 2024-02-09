const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  station_id: Number,
  arrival_time: String,
  departure_time: String,
  fare: Number,
});

const trainSchema = new mongoose.Schema({
  train_id: { type: Number, unique: true, required: true }, // Enforcing uniqueness and making it required
  train_name: String,
  capacity: Number,
  stops: [stopSchema],
},); // Exclude the default _id field

const Train = mongoose.model('Train', trainSchema);

module.exports = Train;
