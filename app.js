﻿let LRS_VERSION = "1.1.0";

require("dotenv").config();
require("rootpath")();
const express = require("express");
const app = express();
const cors = require('cors');
const jwt = require("_helpers/jwt");
const errorHandler = require("_helpers/error-handler");

app.use(cors({ origin: '*' }))

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "500mb" }));

// Serve files in public folder
app.use(express.static("frontend/public"));

// Use JWT auth to secure the API
app.use(jwt());

// User API routes
app.use("/users", require("./users/users.controller"));

// Default route for status
app.get("/status", (req, res) => {
  res.send({ status: "LRS is up", version: LRS_VERSION });
});

// Global error handler
app.use(errorHandler);

// MongoDB direct connection with Mongoose

// Mongo import and init variables
const { MongoClient } = require("mongodb");
var m_client = new MongoClient(process.env.MONGO_URL + process.env.MONGO_DB, { useUnifiedTopology: true });


// Async function to connect to MongoDB and initiaize variables for db and collection
async function connectMongo() {
  try {
    await m_client.connect();
    console.log("Native MongoDB Driver connected");
  } catch (err) {
    console.log("Error connecting to Mongo Server: ", err);
  }
}
connectMongo();

require("./consumers/consumers.js").init(m_client);

// Consumer API routes
app.use("/consumers", require("./consumers/consumers.js").router);

// LRS endpoint to accept post data
app.post("/lrs", (req, res) => {
  try {
    // Encryption of personal data is moved to LTI Tool
    m_client.db().collection(process.env.MONGO_XAPI_COLLECTION).insertOne(req.body, { check_keys: false }, function (err, mong_res) {
      if (err) { throw err }
      console.log("xAPI Record inserted");
      console.log("Mongo Response", mong_res)
      res.send(JSON.stringify({ result: "done" }));
      res.status(200).end();
    });
  } catch (err) {
    console.log(new Date(), "Error inserting record: ", err);
    res.status(500).end();
  }
});

// Get records with find and sorting queries. Also have pagination support (limit and skip)
app.post("/records/get", (req, res) => {
  let query;
  let sort;
  let unwind;
  let limit;
  let skip;
  try {
    req.body.query ? query = req.body.query : query = {};
    req.body.sort ? sort = req.body.sort : sort = {};
    req.body.unwind ? unwind = req.body.unwind : unwind = {};
    req.body.limit ? limit = req.body.limit : 0;
    req.body.skip ? limit = req.body.skip : 0;
    m_client.db().collection(process.env.MONGO_XAPI_COLLECTION).find(query, { limit: limit, skip: skip, sort: sort, unwind: unwind }).toArray(function (err, results) {
      if (err) {
        console.log("Error while getting records", err);
        console.log("Input Query was: ", query);
        console.log("Sort Query was: ", sort);
        console.log("Limit: ", limit);
        console.log("Skip: ", skip);
        res.status(500).end();
      }
      else {
        //console.log("Records request received", req.body);
        res.status(200).send({ total: results.length, results: results }).end();
      }
    });

  }
  catch (err) {
    console.log("Error while getting records", err);
    console.log("Input Query was: ", query);
    console.log("Sort Query was: ", sort);
    console.log("Limit: ", limit);
    console.log("Skip: ", skip);
    res.status(500).end();
  }
});

// Get records with aggregation
app.post("/records/aggregate", async (req, res) => {

  let pipeline;
  let consumer;
  let courseId;
  req.body.consumer ? consumer = req.body.consumer : consumer = "all";
  req.body.courseId ? courseId = req.body.courseId : courseId = "all";

  let hasConsumerAccess = false;
  // Check in the user collection mongodb if consumerAccess array includes consumer
  await m_client.db().collection("users").findOne({ email: req.user.email }, (err, resultUser) => {
    if (err) {
      console.log("Error while getting records", err);
      res.status(500).end();
      return;
    }
    else {
      if (resultUser.consumersAccess.includes(req.body.consumer) || resultUser.role == "admin") {

        hasConsumerAccess = true;

        // Fetch code here

        try {
          req.body.pipeline ? pipeline = req.body.pipeline : pipeline = [];
          if (courseId != "all") {
            pipeline.unshift({
              "$match": {
                "metadata.session.context_id": courseId
              }
            })
          }
          if (consumer != "all") {
            pipeline.unshift({
              "$match": {
                "metadata.session.custom_consumer": consumer
              }
            })
          }


          m_client.db().collection(process.env.MONGO_XAPI_COLLECTION).aggregate(pipeline).toArray(function (err, results) {
            if (err) {
              console.log("Error while Aggregating: ", err);
              console.log("Pipeline: ", pipeline);
              res.status(500).end();
            }
            else {
              //console.log("Aggregate Records request received", JSON.stringify(req.body));
              res.status(200).send({ results }).end();
            }
          });

        }
        catch (err) {
          console.log("Error while aggregating records", err);
          console.log("Pipeline was: ", pipeline);
          res.status(500).end();
        }

        // Fetch code end here

      }
      else {
        console.log("User " + req.user.email + " does not have access to consumer: ", req.body.consumer);
        res.status(403).end();
        return;
      }
    }
  });


});

// Start the Server
const port =
  process.env.NODE_ENV === "production" ? process.env.PORT || 80 : 4000;
app.listen(port, function () {
  console.log("Server listening on port " + port);
});


