const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());
const mindee = require("mindee");
const fs = require("fs");
require("dotenv").config();
const { Expo } = require("expo-server-sdk");
const { initializeApp } = require("firebase/app");
const { getFirestore, getDoc } = require("firebase/firestore");
const {
  collection,
  query,
  where,
  getDocs,
  doc,
  addDoc,
} = require("firebase/firestore");
const cron = require("node-cron");
const firebaseConfig = {
  apiKey: process.env.APIKEY,
  authDomain: process.env.AUTHDOMAIN,
  projectId: process.env.PROJECTID,
  storageBucket: process.env.STORAGEBUCKET,
  messagingSenderId: process.env.MESSAGINGSENDERID,
  appId: process.env.APPID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Init a new client
const mindeeClient = new mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

cron.schedule("0 8 * * *", () => {
  triggerReminders()
    .then()
    .catch((e) => console.log(e));
});


const triggerReminders = async () => {
  console.log("fetching registered device tokens...");
  const tickets = [];
  const expo = new Expo();
  try {
    const tokens = await getTokensFromDb();
    let messages = [];
    for (let i = 0; i < tokens.length; i++) {
      meals = [];
      const {uid} = tokens[i];
      const userSpecificMeals = await getUserMeals(uid);
      const expiringMeals = getMealsExpiringWithin24Hours(userSpecificMeals);
      meals.push(...expiringMeals);

      console.log("--------------------------------------")
      console.log(`${tokens[i].uid}: ${meals.length} expiring tomorrow`)

      if (expiringMeals.length > 0) {
        messages.push({
          to: tokens[i].token,
          sound: "default",
          body: `${meals.length > 1 ? `${meals.length} foods` : meals[i].data.name} expiring tomorrow`,
          uid: meals[i].data.uid,
          name: meals[i].data.name,
          foodId:meals[i].id
        });
      } 
    }


    const chunks = expo.chunkPushNotifications(messages)
    for (let chunk of chunks) {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }
  } catch (e) {  
    console.log("error", e);
  }

  let receiptIds = [];
  for (let ticket of tickets) {
    // NOTE: Not all tickets have IDs; for example, tickets for notifications
    // that could not be enqueued will have error information and no receipt ID.
    if (ticket.id) {
      receiptIds.push(ticket.id);
    }
  }

  let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  // Like sending notifications, there are different strategies you could use
  // to retrieve batches of receipts from the Expo service.
  for (let chunk of receiptIdChunks) {
    try {
      let receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      console.log("receipts", receipts);

      // The receipts specify whether Apple or Google successfully received the
      // notification and information about an error, if one occurred.
      for (let receiptId in receipts) {
        let { status, message, details } = receipts[receiptId];
        if (status === 'ok') {
          handleDeviceNotRegistered(chunk)
          continue;
        } else if (status === 'error') {
          console.error(
            `There was an error sending a notification: ${message}`
          );
          if (details && details.error) {
            handleDeviceNotRegistered(chunk)
            // if (details.error === "DeviceNotRegistered") {
            //   handleDeviceNotRegistered(chunk)
            // }

            // The error codes are listed in the Expo documentation:
            // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
            // You must handle the errors appropriately.
            console.error(`The error code is ${details.error}`);
          }
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
};

const handleDeviceNotRegistered = (chunk) => {
  console.log("chunk", chunk)
}

const getMealsExpiringWithin24Hours = (meals) => {
  const {tomorrow, today} = getTimeFrames();
  return meals.filter(
    (doc) => doc.data.date < tomorrow && doc.data.date > today.getTime()
  );
}

const getUserMeals = async (uid) => {
  return (await getDocs(getQuery(uid))).docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
}

const getQuery = (uid) => {
  return query(
    collection(db, "foods"),
    where("uid", "==", uid)
  )
}

const getTimeFrames = () => {
  return {
    tomorrow: new Date().setDate(new Date().getDate() + 1),
    today: new Date()
  }
}

const getTokensFromDb = async () => {
  const tokensQuery = await getDocs(collection(db, "tokens"));
  return tokensQuery.docs.map((x) => x.data());;
}


app.get("/health-check", async (req, res) => {
  res.send("working")
});

app.get("/dev", async (req, res) => {
  await triggerReminders();
  res.send("done")
});

app.post("/token/store", async (req, res) => {
  try {
    const q = query(collection(db, "tokens"), where("uid", "==", req.body.uid));
    const x = await getDocs(q);
    if (x.docs.some((doc) => doc.exists())) {
      res.send({
        message: "token already exists"
      });
    } else {
      await addDoc(ref, {
        token: req.body.token,
        uid: req.body.uid,
      });
      res.status(201).send({
        message: "token added"
      });
    }
  } catch (e) {
    console.error("Error adding document: ", e);
    res.status(500).send(e);
  }

  // try {
  //   await addDoc(ref, {
  //     token: req.body.token,
  //     uid: req.body.uid
  //   });
  //   res.status(201).end();
  // } catch (e) {
  //     console.error("Error adding document: ", e);
  //     res.status(500).send(e)
  // }
});

app.post("/receipt/process", async (req, res) => {
  console.log("process receipt request received");
  try {
    const apiResponse = await mindeeClient
      .docFromUrl(req.body.url)
      .parse(mindee.ReceiptV5);

    if (apiResponse.document === undefined) {
      res.send({ message: "document data undefined" });
      return;
    }
    console.log("receipt processed, returning meals");

    res.json({
      meals: apiResponse.document.lineItems.map((x) => x.description),
    });
  } catch (e) {
    console.log("error", e);
    res.send(e);
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`Listen on the port ${process.env.PORT}...`);
});
