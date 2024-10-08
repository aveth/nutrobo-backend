require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const fbAdmin = require('firebase-admin');

const pjson = require('./package.json');

const authMw = require('./src/middleware/auth');
const timeoutMw = require('./src/middleware/timeout');
const logMw = require('./src/middleware/log');

const threadService = require('./src/services/thread');
const userService = require('./src/services/user');
const foodService = require('./src/services/food');

const app = express();

fbAdmin.initializeApp({
    credential: fbAdmin.credential.cert('./.secrets/nutrobo-service-account.json')
});

app.use(bodyParser.json());
app.use(logMw.log());
app.use(timeoutMw.setTimeout());
app.use(authMw.validateToken());


const port = process.env.PORT || 3000;

if (process.env.NODE_ENV == 'prod') {
    process.on('uncaughtException', function(err) {
        console.log(`Unhandled exception: ${err}`);
    });
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

app.get('/', (req, res) => {
    res.status(200).json({
        title: 'Nutrobo API',
        apiVersion: pjson.version,
        nodeVersion: process.version,
        env: process.env.NODE_ENV
    });
});

app.post(
    '/v1/assistant/create-thread', 
    threadService.create()
);

app.post(
    '/v1/assistant/send-message/:threadId',
    threadService.sendMessage()
);

app.post(
    '/v1/assistant/send-barcode/:threadId',
    threadService.sendBarcode()
);

app.post(
    '/v1/assistant/send-nutrition-info/:threadId', 
    threadService.sendNutritionInfo()
);

app.get(
    '/v1/assistant/get-thread/:threadId', 
    threadService.get()
);

app.get(
    '/v1/food/get-by-barcode/:barcode', 
    foodService.get()
);

app.get(
    '/v1/user/get-profile', 
    userService.get()
);

app.put(
    '/v1/user/update-profile', 
    userService.update()
);

