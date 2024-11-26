const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());
const mindee = require("mindee");
const fs = require("fs");
const mealsDb = require("./mealsDb");
require("dotenv").config();
const { Expo } = require("expo-server-sdk");
const { initializeApp } = require("firebase/app");
const { getFirestore, getDoc, deleteDoc } = require("firebase/firestore");
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
      const { uid } = tokens[i];
      const userSpecificMeals = await getUserMeals(uid);
      const expiringMeals = getMealsExpiringToday(userSpecificMeals);

      console.log("--------------------------------------");
      console.log(`${tokens[i].uid}: ${expiringMeals.length} expiring today`);

      // if (expiringMeals.length > 0) {
      //   expiringMeals.forEach((ep, mealIndex) => {
      //     messages.push({
      //       to: tokens[i].token,
      //       sound: "default",
      //       body: `${expiringMeals.length > 1 ? `${expiringMeals.length} foods` : expiringMeals[mealIndex].data.name} expiring today`,
      //       uid,
      //       name: expiringMeals[mealIndex].data.name,
      //       foodId: expiringMeals[mealIndex].id
      //     });
      //   })
      // }

      if (expiringMeals.length > 0) {
        // Create one consolidated message for the user
        messages.push({
          to: tokens[i].token,
          sound: "default",
          body: `${expiringMeals.length} food${
            expiringMeals.length > 1 ? "s" : ""
          } expiring today`,
          uid,
          // mealNames: expiringMeals.map((meal) => meal.data.name).join(", "), // Optional: Add meal names if needed
          // foodIds: expiringMeals.map((meal) => meal.id), // Optional: Include IDs for tracking
        });
      }
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log("Notification sent for " + chunk[0].uid);
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
    } else {
      console.log("ticket", ticket);
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
        if (status === "ok") {
          continue;
        } else if (status === "error") {
          console.error(
            `There was an error sending a notification: ${message}`
          );
          if (details && details.error) {
            console.log("chunk", chunk);
            if (details.error === "DeviceNotRegistered") {
              console.log("chunk", chunk);
            }

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

const getMealsExpiringToday = (meals) => {
  const today = formatDate();
  return meals.filter((doc) => formatDate(doc.data.date) === today);
};

const getUserMeals = async (uid) => {
  return (await getDocs(getQuery(uid))).docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
};

const getQuery = (uid) => {
  return query(collection(db, "foods"), where("uid", "==", uid));
};

const formatDate = (date) => {
  const theDate = date ? new Date(date) : new Date();
  return theDate.toISOString().split("T")[0];
};

const getTokensFromDb = async () => {
  const tokensQuery = await getDocs(collection(db, "tokens"));
  return tokensQuery.docs.map((x) => x.data());
};

app.get("/health-check", async (req, res) => {
  res.send("working");
});

app.get("/dev", async (req, res) => {
  await triggerReminders();
  res.send("done");
});

app.delete("/token/delete", async (req, res) => {
  try {
    const q = query(collection(db, "tokens"), where("uid", "==", req.body.uid));
    const data = await getDocs(q);
    if (data.docs.some((doc) => doc.exists())) {
      await deleteDoc(data.docs[0].ref);
      console.log(`Token for ${req.body.uid} removed`);
    } else {
      console.log(`No documents found for ${req.body.uid}`);
    }
    res.status(200).send();
  } catch (e) {
    console.error("Error removing document: ", e);
    res.status(500).send(e);
  }
});

app.post("/token/store", async (req, res) => {
  const ref = collection(db, "tokens");
  try {
    const q = query(ref, where("uid", "==", req.body.uid));
    const data = await getDocs(q);
    if (data.docs.some((doc) => doc.exists())) {
      console.log("--------------------------------------");
      console.log("token already exists");
      res.send({
        message: "token already exists",
      });
    } else {
      await addDoc(ref, {
        token: req.body.token,
        uid: req.body.uid,
      });
      res.status(201).send({
        message: "token added",
      });
    }
  } catch (e) {
    console.error("Error adding document: ", e);
    res.status(500).send(e);
  }
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

    const meals = apiResponse.document.lineItems.map((x) => x.description);

    const formattedMeals = meals.map((food) => {
      const found = mealsDb.find((x) =>
        food.toLowerCase().includes(x.toLowerCase())
      );
      return found ? found : food;
    });

    res.json({
      meals: formattedMeals,
    });
  } catch (e) {
    console.log("error", e);
    res.send(e);
  }
});

app.listen(3000 || 8080, () => {
  console.log(`Listen on the port ${3000}...`);
});
