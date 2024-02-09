// db/connection.js
const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/samurai_train_service', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

module.exports = mongoose.connection;
