// models/station.js
const mongoose = require('mongoose');

const stationSchema = new mongoose.Schema({
  station_id: Number,
  station_name: String,
  longitude: Number,
  latitude: Number,
});

const Station = mongoose.model('Station', stationSchema);

module.exports = Station;
