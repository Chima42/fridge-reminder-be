const express = require("express");
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const mindee = require("mindee");
const fs = require("fs");
require('dotenv').config();

// Init a new client
const mindeeClient = new mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

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
    console.log("Listen on the port 4800...");
});