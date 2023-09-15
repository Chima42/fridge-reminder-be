const express = require("express");
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const mindee = require("mindee");
const fs = require("fs");
require('dotenv').config();
const { Expo } = require("expo-server-sdk");
const { initializeApp } = require("firebase/app");
const { getFirestore, getDoc } = require("firebase/firestore");
const { collection, query, where, getDocs, doc } = require("firebase/firestore");
const cron = require('node-cron');

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.MESSENGER_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Init a new client
const mindeeClient = new mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

cron.schedule('*/5 * * * *', () => {
    triggerReminders().then().catch(e => console.log(e));
});

const triggerReminders = async() => {
    console.log("x reminder started");
    console.log("fetching registered device tokens...");
    try {
        const tokensQuery = await getDocs(collection(db, "tokens"));
        const tokens = tokensQuery.docs.map(x => x.data());
        const meals = []
        const inSevenDays = new Date().setDate(new Date().getDate() + 7);
        const today = new Date();
        for (let i = 0; i < tokens.length; i++) {
            const q = query(collection(db, "foods"), where("uid", "==", tokens[i].uid));
            const userSpecificMeals = (await getDocs(q)).docs.map(doc => doc.data());
            const foodsExpiringThisWeek = userSpecificMeals
            .filter(doc => doc.date < inSevenDays && doc.date > today.getTime())
            meals.push(...foodsExpiringThisWeek)
            const expo = new Expo();
            if (foodsExpiringThisWeek.length > 0) {
                const chunks = expo.chunkPushNotifications([
                    { to: record.token, sound: "default", body: `${foodsExpiringThisWeek} foods expiring this week` }
                ]);
                res.send(foodsExpiringThisWeek);
            }
        }
        res.send({meals, inSevenDays});
    } catch (e) {
        console.log(e)
        res.json(e)
    }
}

app.get("/dev/test", async (req, res) => {
    try {
        const tokensQuery = await getDocs(collection(db, "tokens"));
        const tokens = tokensQuery.docs.map(x => x.data());
        const meals = []
        const inSevenDays = new Date().setDate(new Date().getDate() + 7);
        const today = new Date();
        for (let i = 0; i < tokens.length; i++) {
            const q = query(collection(db, "foods"), where("uid", "==", tokens[i].uid));
            const userSpecificMeals = (await getDocs(q)).docs.map(doc => doc.data());
            const foodsExpiringThisWeek = userSpecificMeals
            .filter(doc => doc.date < inSevenDays && doc.date > today.getTime())
            meals.push(...foodsExpiringThisWeek) 
            const expo = new Expo();
            if (foodsExpiringThisWeek.length > 0) {
                const chunks = expo.chunkPushNotifications([
                    { to: record.token, sound: "default", body: `${foodsExpiringThisWeek} foods expiring this week` }
                ]);
                res.send(foodsExpiringThisWeek);
            }
        }
        res.send({meals, inSevenDays});
    } catch (e) {
        console.log(e)
        res.json(e)
    }
});

app.post("/token/store", async (req, res) => {
    try {
        const q = query(collection(db, "tokens"), where("uid", "==", req.body.uid));
        const x = await getDocs(q)
        if (x.docs.some(doc => doc.exists())) {
            res.send();
        } else {
            await addDoc(ref, {
                token: req.body.token,
                uid: req.body.uid
            });
            res.status(201).end();
        }
    } catch(e) {
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
    console.log("process receipt request received")
    try {
        const apiResponse = await mindeeClient
        .docFromUrl(req.body.url)
        .parse(mindee.ReceiptV5);
        
        if (apiResponse.document === undefined) {
            res.send({message: "document data undefined"})
            return;
        };
        console.log("receipt processed, returning meals")

        res.json({meals: apiResponse.document.lineItems.map(x => x.description)})
    } catch(e) {
        console.log("error",e)
        res.send(e)
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Listen on the port ${process.env.PORT}...`);
});