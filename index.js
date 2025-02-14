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
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const cron = require("node-cron");
const admin = require("firebase-admin");
const client = new SecretManagerServiceClient();
async function getSecret() {
  const [version] = await client.accessSecretVersion({
    name: "projects/fridge-reminders-auth/secrets/fridgeRemindersServiceAccountKey/versions/latest",
  });

  const payload = version.payload.data.toString();
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(payload)),
  });
}

let db;

const mindeeClient = new mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

cron.schedule("0 8 * * *", () => {
  triggerReminders()
    .then()
    .catch((e) => console.log(e));
});

const triggerReminders = async () => {
  console.log("Loading credentials...");
  db = await loadSecret();
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

      if (expiringMeals.length > 0) {
        // Create one consolidated message for the user
        messages.push({
          to: tokens[i].token,
          sound: "default",
          body: getNotificationMessage(expiringMeals),
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

const sendAOneOffReminder = async (uid) => {
  console.log("Loading credentials...");
  db = await loadSecret();
  console.log("fetching registered device tokens...");
  const tickets = [];
  const expo = new Expo();
  try {
    const tokens = (await getTokensFromDb()).filter((x) => x.uid === uid);
    let messages = [];
    for (let i = 0; i < tokens.length; i++) {
      const { uid } = tokens[i];
      const userSpecificMeals = await getUserMeals(uid);
      const expiringMeals = getMealsExpiringToday(userSpecificMeals);

      console.log("--------------------------------------");
      console.log(`${tokens[i].uid}: ${expiringMeals.length} meals for today`);

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
          body: getNotificationMessage(expiringMeals),
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

const getNotificationMessage = (meals) => {
  const counts = { prep: 0, defrost: 0, cook: 0, expiry: 0 };
  // Count occurrences of each reminder type
  meals.forEach(({ data }) => {
    if (counts[data.reminderType] !== undefined) {
      counts[data.reminderType]++;
    }
    if (data.state === 1) {
      counts["defrost"]++;
    }
  });

  const parts = [];

  if (counts.prep) parts.push(`${counts.prep} to prep`);
  if (counts.defrost) parts.push(`${counts.defrost} to defrost`);
  if (counts.cook) parts.push(`${counts.cook} to cook`);
  if (counts.expiry) parts.push(`${counts.expiry} expiring`);

  if (parts.length === 0) return meals.length + " food expiring today"; // No reminders

  // Determine singular/plural for "meal(s)"
  const firstCount = parseInt(parts[0].split(" ")[0], 10);
  const mealWord = firstCount === 1 ? "food" : "foods";

  // Add "meal" or "meals" to the first item
  parts[0] = `${firstCount} ${mealWord} ${parts[0].slice(
    parts[0].indexOf("to") !== -1
      ? parts[0].indexOf("to")
      : parts[0].indexOf("expiring")
  )}`;

  // Format the final message, ensuring "today" appears only once
  const message = `You have ${parts.slice(0, -1).join(", ")}${
    parts.length > 1 ? " and " : ""
  }${parts[parts.length - 1]} today.`;

  return message;
};

const loadSecret = async () => {
  try {
    await getSecret();
    console.log("Credentials loading succeeded");
    return admin.firestore();
  } catch (e) {
    console.log("Credentials loading failed", e);
    return undefined;
  }
};

// filtering out eaten and expired meals
const getMealsExpiringToday = (meals) => {
  const today = formatDate();
  return meals
    .filter((doc) => formatDate(doc.data.date) === today)
    .filter((doc) => !doc.data.expired)
    .filter((doc) => !doc.data.eaten);
};

const getUserMeals = async (uid) => {
  const querySnapshot = await db
    .collection(process.env.FOODS_DB_NAME)
    .where("uid", "==", uid)
    .get();
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
};

const formatDate = (date) => {
  const theDate = date ? new Date(date) : new Date();
  return theDate.toISOString().split("T")[0];
};

const getTokensFromDb = async () => {
  const tokens = await db.collection(process.env.TOKENS_DB_NAME).get();
  console.log("fectch tokens", tokens);
  return tokens.docs.map((x) => x.data());
};

app.get("/health-check", async (req, res) => {
  res.send("working");
});

app.get("/dev", async (req, res) => {
  await triggerReminders();
  res.send("done");
});

app.post("/send-reminder/:uid", async (req, res) => {
  await sendAOneOffReminder(req.params["uid"]);
  res.send("done");
});

app.delete("/token/delete", async (req, res) => {
  const uid = req.body.uid;

  try {
    // Reference to the "tokens" collection
    const tokensRef = db.collection(process.env.TOKENS_DB_NAME);

    // Query to find documents where the 'uid' matches the provided uid
    const snapshot = await tokensRef.where("uid", "==", uid).get();

    // Map the data to include document references
    const data = snapshot.docs.map((doc) => ({
      ...doc.data(),
      ref: doc.ref,
    }));

    // Loop through and delete each document
    for (const doc of data) {
      try {
        await doc.ref.delete();
        console.log(`Deleted token for uid: ${uid}`);
      } catch (deleteError) {
        console.error(`Error deleting document: ${deleteError}`);
      }
    }

    res.status(200).send("Documents deleted successfully");
  } catch (e) {
    console.error("Error removing document: ", e);
    res.status(500).send(e);
  }
});

app.post("/token/store", async (req, res) => {
  const uid = req.body.uid;
  const token = req.body.token;

  try {
    // Reference to the "tokens" collection
    const tokensRef = db.collection(process.env.TOKENS_DB_NAME);

    // Query to check if a document with the same 'uid' already exists
    const snapshot = await tokensRef.where("uid", "==", uid).get();

    // Check if the token already exists
    if (!snapshot.empty) {
      console.log("--------------------------------------");
      console.log("token already exists");
      res.send({
        message: "token already exists",
      });
    } else {
      // Add a new token document if it doesn't exist
      await tokensRef.add({
        token: token,
        uid: uid,
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

app.listen(process.env.PORT || 8080, () => {
  console.log(`Listen on the port ${process.env.PORT || 8080}...`);
});
