const express = require('express');
const bodyParser = require('body-parser');
const connection = require('./db/connection');
const User = require('./models/user');
const Station = require('./models/station');
const Train = require('./models/train');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 8000;

let ticket = 1;

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

// Function to calculate the cost of the ticket and optimal route
async function calculateTicketCost(trains,stationFromId, stationToId, timeAfter) {
  // Find all trains that connect the source and destination stations
  // const trains = await Train.find({
  //   'stops.station_id': { $in: [stationFromId, stationToId] },
  // });
  // Sort the trains based on their departure times
  trains.sort(async (a, b) => {
    const departureA = a.stops.find(stop => stop.station_id === stationFromId)?.departure_time;
    const departureB = b.stops.find(stop => stop.station_id === stationFromId)?.departure_time;

    // Calculate total cost for each train and compare
    const costA = await calculateTotalCost(a, stationFromId, stationToId);
    const costB = await calculateTotalCost(b, stationFromId, stationToId);

    // Sort by departure time first, and if the same, by total cost
    if (departureA.localeCompare(departureB) !== 0) {
      return departureA.localeCompare(departureB);
    } else {
      return costA - costB;
    }
  });

  console.log(JSON.stringify(trains, null, 2));

  // Calculate the optimal route and total cost for the train with the minimum cost
  const optimalTrain = trains[0];
  const sourceIndex = optimalTrain.stops.findIndex(stop => stop.station_id === stationFromId);
  const destinationIndex = optimalTrain.stops.findIndex(stop => stop.station_id === stationToId);
  const route = optimalTrain.stops.slice(sourceIndex, destinationIndex + 1);
  const totalCost = route.reduce((acc, stop) => acc + stop.fare, 0);

  return { totalCost, route };
}

async function calculateTotalCost(train, stationFromId, stationToId) {
  const sourceIndex = train.stops.findIndex(stop => stop.station_id === stationFromId);
  const destinationIndex = train.stops.findIndex(stop => stop.station_id === stationToId);

  if (sourceIndex !== -1 && destinationIndex !== -1 && sourceIndex <= destinationIndex) {
    const stopsOnRoute = train.stops.slice(sourceIndex, destinationIndex + 1);
    const totalCost = stopsOnRoute.reduce((acc, stop) => acc + stop.fare, 0);
    return totalCost;
  }

  return -5; // Return Infinity for trains that don't cover the full route
}


// Function to generate a unique ticket ID
function generateTicketId() {
  return ticket++;
}

// API endpoint to purchase a ticket
app.post('/api/tickets', async (req, res) => {
  const { wallet_id, time_after, station_from, station_to } = req.body;

  try {
    // Find the user based on wallet_id
    const user = await User.findOne({ user_id: wallet_id });

    // Check if the user exists
    if (!user) {
      return res.status(404).json({ message: `User with id ${wallet_id} not found` });
    }

    
    const trains = await Train.find();
    let selectedTrains = [];
    trains.forEach((train) => {
      const stops = train.stops;
      const ll = stops.find(stop => stop.station_id === station_to);
      console.log(ll);
      if (ll!=undefined) {
        
        for (let i = 0; i < stops.length; i++) {
          const departureTime = moment(`1970-01-01T${stops[i].departure_time}:00`, 'YYYY-MM-DDTHH:mm:ss');
          const timeAfter = moment(`1970-01-01T${time_after}:00`, 'YYYY-MM-DDTHH:mm:ss');
          console.log(departureTime,timeAfter,departureTime >timeAfter);
          if (stops[i].station_id === station_from && departureTime > timeAfter) {
            console.log("found");
            selectedTrains.push(train);
            break;
          }
        }
      }
    });
    console.log(selectedTrains);

    if (selectedTrains.length === 0) {
      return res.status(403).json({ message: `No available trains for station: ${station_from} to station: ${station_to}` });
    }

    // Calculate the cost and optimal route
    const { totalCost, route } = await calculateTicketCost(selectedTrains,station_from, station_to, time_after);
    console.log({ totalCost, route });
    
    // Check if the user has sufficient balance
    if (user.balance < totalCost) {
      const shortageAmount = totalCost - user.balance;
      return res.status(402).json({ message: `Recharge amount: ${shortageAmount} to purchase the ticket` });
    }

    // Update the user's balance
    user.balance -= totalCost;
    await user.save();

    // Generate a unique ticket ID
    const ticket_id = generateTicketId();

    // Respond with the ticket details
    res.status(201).json({
      ticket_id,
      balance: user.balance,
      wallet_id: user.user_id,
      stations: route,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
