// models/ticket.js
const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticket_id: { type: Number, unique: true, required: true },
  wallet_id: { type: Number, required: true },
  balance: { type: Number, required: true },
  stations: [
    {
      station_id: { type: Number, required: true },
      train_id: { type: Number, required: true },
      arrival_time: String,
      departure_time: String,
    },
  ],
});

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = Ticket;
