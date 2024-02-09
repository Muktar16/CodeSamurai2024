const express = require('express');
const bodyParser = require('body-parser');
const connection = require('./db/connection');
const User = require('./models/user');
const Station = require('./models/station');
const Train = require('./models/train');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(bodyParser.json());

connection.once('open', () => {
  console.log('Connected to MongoDB');
});

// users apis
app.post('/api/users', async (req, res) => {
  try {
    const newUser = await User.create(req.body);
    res.status(201).json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});




// stations apis
app.post('/api/stations', async (req, res) => {
  try {
    const newStation = await Station.create(req.body);
    res.status(201).json(newStation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API to list all stations from MongoDB
app.get('/api/stations', async (req, res) => {
  try {
    const stations = await Station.find().sort({ station_id: 1 });
    res.status(200).json({ stations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API to list trains for a specific station from MongoDB
app.get('/api/stations/:station_id/trains', async (req, res) => {
  const stationId = parseInt(req.params.station_id);

  try {
    // Find distinct train_ids for the specified station_id
    const distinctTrainIds = await Train.distinct('train_id', {
      'stops': {
        $elemMatch: { 'station_id': stationId }
      }
    });

    // Find the first stop for each distinct train_id
    const trainsAtStation = await Train.aggregate([
      {
        $match: {
          'train_id': { $in: distinctTrainIds }
        }
      },
      {
        $unwind: '$stops'
      },
      {
        $match: {
          'stops.station_id': stationId
        }
      },
      {
        $group: {
          _id: '$train_id',
          firstStop: { $first: '$stops' }
        }
      },
      {
        $sort: {
          'firstStop.departure_time': 1,
          '_id': 1
        }
      }
    ]);

    const formattedTrains = trainsAtStation.map(train => ({
      train_id: train._id,
      arrival_time: train.firstStop.arrival_time,
      departure_time: train.firstStop.departure_time
    }));
    if(formattedTrains.length === 0){
      res.status(404).json({ "message": `station with id: ` + stationId + ` was not found`});
      return;
    }
    res.status(200).json({ station_id: stationId, trains: formattedTrains });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});




// trains apis
app.post('/api/trains', async (req, res) => {
  try {
    const newTrain = await Train.create(req.body);

    // Customize the response
    const { stops, ...trainSummary } = newTrain.toObject(); // Extract stops and other fields
    const num_stations = stops.length; // Calculate the number of stations
    const service_start = stops[0].departure_time; // Get the first stop's arrival time
    const service_ends = stops[num_stations - 1].arrival_time; // Get the last stop's departure time

    const response = {
      ...trainSummary,
      num_stations,
      service_start,
      service_ends,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


// wallet api

// Endpoint to get wallet balance
app.get('/api/wallets/:wallet_id', async(req, res) => {
  const walletId = parseInt(req.params.wallet_id);

  // Find the wallet with the given ID
  const wallet = await User.findOne({ user_id: walletId });

  if (!wallet) {
    return res.status(404).json({ message: `wallet with id: ${walletId} was not found` });
  }

  // Respond with wallet information
  res.status(200).json({
    wallet_id: wallet.user_id,
    balance: wallet.balance,
    wallet_user: {
      user_id: wallet.user_id,
      user_name: wallet.user_name,
    },
  });
});


// Endpoint to add funds to the user's wallet
app.put('/api/wallets/:wallet_id', async(req, res) => {
  const walletId = parseInt(req.params.wallet_id);
  const rechargeAmount = req.body.recharge;

  // Find the wallet with the given ID
  const wallet = await User.findOne({ user_id: walletId });

  if (!wallet) {
    return res.status(404).json({ message: `wallet with id: ${walletId} was not found` });
  }

  // Check if the recharge amount is within the allowed range
  if (rechargeAmount < 100 || rechargeAmount > 10000) {
    return res.status(400).json({ message: `invalid amount: ${rechargeAmount}` });
  }

  // Update the wallet balance
  wallet.balance += rechargeAmount;

  // Find the associated user
  const user = await User.updateOne(
    { user_id: wallet.user_id },
    { $inc: { balance: rechargeAmount } }, // Increment the balance
    { new: true } // Return the updated user document
  );

  console.log(user);

  // Respond with updated wallet information
  res.status(200).json({
    wallet_id: wallet.user_id,
    balance: wallet.balance,
    wallet_user: {
      user_id: wallet.user_id,
      user_name: wallet.user_name,
    },
  });
});


// tickets api

// Endpoint to purchase a ticket
app.post('/api/tickets', async (req, res) => {
  const walletId = parseInt(req.body.wallet_id);
  const timeAfter = req.body.time_after;
  const stationFromId = parseInt(req.body.station_from);
  const stationToId = parseInt(req.body.station_to);

  try {
    // Find the user with the given ID (assuming wallet_id is user_id)
    const user = await User.findOne({ user_id: walletId });

    if (!user) {
      return res.status(404).json({ message: `user with id: ${walletId} was not found` });
    }

    // Calculate the cost of the ticket
    const { totalCost, route } = await calculateTicketCost(stationFromId, stationToId, timeAfter);

    // Check if the user's balance is sufficient
    if (user.balance < totalCost) {
      const shortageAmount = totalCost - user.balance;
      return res.status(402).json({ message: `recharge amount: ${shortageAmount} to purchase the ticket` });
    }

    // Update the user's balance
    user.balance -= totalCost;
    await user.save();

    // Generate a unique ticket ID
    const ticketId = generateTicketId();

    // Create the ticket object
    const ticket = new Ticket({
      ticket_id: ticketId,
      wallet_id: walletId,
      balance: user.balance,
      stations: route,
    });

    // Save the ticket to the database
    await ticket.save();

    // Respond with the ticket information
    res.status(201).json({
      ticket_id: ticketId,
      balance: user.balance,
      wallet_id: walletId,
      stations: route,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Function to calculate the cost of the ticket and optimal route
async function calculateTicketCost(stationFromId, stationToId, timeAfter) {
  // Your logic to calculate the optimal route and total cost goes here
  // This is a placeholder implementation, you need to replace it with your actual logic

  // For demonstration purposes, let's assume a simple route with a fixed cost
  const route = [
    { station_id: 1, train_id: 3, departure_time: '11:00', arrival_time: null },
    { station_id: 3, train_id: 2, departure_time: '12:00', arrival_time: '11:55' },
    { station_id: 5, train_id: 2, departure_time: null, arrival_time: '12:25' },
  ];

  // Calculate the total cost based on the fixed fare for this example
  const totalCost = route.reduce((cost, station, index) => {
    if (index > 0) {
      // Add the fare for each consecutive pair of stations
      cost += getFare(route[index - 1].station_id, station.station_id);
    }
    return cost;
  }, 0);

  return { totalCost, route };
}

// Function to get the fare between two stations (placeholder implementation)
function getFare(stationFromId, stationToId) {
  // Your logic to get the fare between two stations goes here
  // This is a placeholder implementation, you need to replace it with your actual logic

  // For demonstration purposes, let's assume a fixed fare
  return 10;
}

// Function to generate a unique ticket ID
function generateTicketId() {
  // Your logic to generate a unique ticket ID goes here
  // This is a placeholder implementation, you need to replace it with your actual logic

  // For demonstration purposes, let's generate a random number as the ticket ID
  return Math.floor(Math.random() * 1000);
}



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
