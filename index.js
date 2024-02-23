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
  try {
    const tokensQuery = await getDocs(collection(db, "tokens"));
    const tokens = tokensQuery.docs.map((x) => x.data());
    let meals = [];
    const tomorrow = new Date().setDate(new Date().getDate() + 1);
    const today = new Date();
    let messages = [];
    const expo = new Expo();

    messages = []
    for (let i = 0; i < tokens.length; i++) {
      meals = []
      const q = query(
        collection(db, "foods"),
        where("uid", "==", tokens[i].uid)
      );
      const userSpecificMeals = (await getDocs(q)).docs.map((doc) => ({
        id: doc.id,
        data: doc.data(),
      }));

      const mealsExpiringWithin24Hours = userSpecificMeals.filter(
        (doc) => doc.data.date < tomorrow && doc.data.date > today.getTime()
      );
      meals.push(...mealsExpiringWithin24Hours);

      console.log("--------------------------------------")
      console.log(`${tokens[i].uid}: ${meals.length} expiring tomorrow`)
      console.log(`${tokens[i].uid}: ${meals}`)

      if (mealsExpiringWithin24Hours.length > 0) {

        messages.push({
          to: tokens[i].token,
          sound: "default",
          body: `${meals.length > 1 ? `${meals.length} foods` : meals[i].data.name} expiring tomorrow`,
          uid: meals[i].data.uid,
          name: meals[i].data.name,
          foodId:meals[i].id
        });

        // const chunks = expo.chunkPushNotifications(messages);

        // console.log(chunks)

        // for (let chunk of chunks) {
        //   const uid = chunk[0].uid;
        //   const name=chunk[0].name
        //   const foodId=chunk[0].foodId


        //   const notificationRef = collection(db, "notifications");

        //   console.log(notificationRef)

        //   const q = query(
        //     collection(db, "notifications"),
        //     where("uid", "==", uid),
        //     where("name", "==", name),
        //     where("foodId", "==", foodId)
        //   );
        //   const existingNotification = (await getDocs(q)).docs.map((doc) =>
        //     doc.data()
        //   );


        //   if (!existingNotification || existingNotification.length === 0) {
        //     let ticketChunk = await expo.sendPushNotificationsAsync(chunk);

        //     const newNotification = {
        //       uid: uid,
        //       sent: true, // Update sent status to true
        //       name:name,
        //       foodId:foodId
        //     };

        //     // await addDoc(notificationRef, newNotification);
        //   } else {
        //     console.log("Notification already sent for UID:", uid);
        //   }
        // }

        // res.send(foodsExpiringThisWeek);
      } 
    }


    const chunks = expo.chunkPushNotifications(messages)

    chunks.forEach(chunk => {
      expo.sendPushNotificationsAsync(chunk).then(res => {
        console.log(res, "success")
      }).catch(err => {  
        console.log('err while sending notifications')
      })
    })
  } catch (e) {  
    console.log(e);
  }
};


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
