import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

import { createAndRunConverter } from './converter';
import { argv } from 'process';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;


// Crea un servidor HTTP con Express
const server = http.createServer(app);
// Crea un WebSocketServer
const wss = new WebSocketServer({ server });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: 'uploads/' });

const isDev = process.env.NODE_ENV !== 'production';

app.use(cors());


const outputFolder = process.env.E2G_OUTPUT_FOLDER || 'e2g-output';
console.log("outputFolder:", outputFolder);
app.use("/" + outputFolder, express.static(outputFolder));


app.get('/env', async (req, res) => {
  // Return the environment variables
  const envsToSend = {
    GHOSTFOLIO_VALIDATE: process.env.GHOSTFOLIO_VALIDATE,
    GHOSTFOLIO_IMPORT: process.env.GHOSTFOLIO_IMPORT,
    GHOSTFOLIO_UPDATE_CASH: process.env.GHOSTFOLIO_UPDATE_CASH,
    GHOSTFOLIO_ACCOUNT_ID: process.env.GHOSTFOLIO_ACCOUNT_ID,
    GHOSTFOLIO_URL: process.env.GHOSTFOLIO_URL,
    GHOSTFOLIO_SECRET: process.env.GHOSTFOLIO_SECRET,
    serverUrl: process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3001/',
    isDev: process.env.NODE_ENV !== 'production',
  }
  res.send(envsToSend);
})


app.post('/upload', upload.single('file'), async (req, res) => {
  console.log("/upload called");
  const file = req.file;
  const options = {
    debugLogging: process.env.DEBUG_LOGGING === 'true',
    preferredExchange: process.env.DEGIRO_PREFERED_EXCHANGE_POSTFIX,
    accountCurrency: process.env.XTB_ACCOUNT_CURRENCY,
    validate: process.env.GHOSTFOLIO_VALIDATE === 'true',
    accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
    import: process.env.GHOSTFOLIO_IMPORT === 'true',
    url: process.env.GHOSTFOLIO_URL,
    secret: process.env.GHOSTFOLIO_SECRET,
    updateCash: process.env.GHOSTFOLIO_UPDATE_CASH === 'true',
  };

  if (!file) {
    return res.status(400).send('No file uploaded.');
  }

  // Process the file and options here
  console.log('File received:', file);
  console.log('Options:', options);

  // extract payload from the request:
  

  const converter = req.body.broker;
  console.log('Converter:', converter);
  const inputFile = file.path;

  if (typeof(req.body.GHOSTFOLIO_VALIDATE) !== 'undefined')
    process.env.GHOSTFOLIO_VALIDATE = req.body.GHOSTFOLIO_VALIDATE;
  if (typeof(req.body.GHOSTFOLIO_IMPORT) !== 'undefined')
    process.env.GHOSTFOLIO_IMPORT = req.body.GHOSTFOLIO_IMPORT;
  if (typeof(req.body.GHOSTFOLIO_UPDATE_CASH) !==  'undefined')
    process.env.GHOSTFOLIO_UPDATE_CASH = req.body.GHOSTFOLIO_UPDATE_CASH;
  if (typeof(req.body.GHOSTFOLIO_ACCOUNT_ID) !== 'undefined')
    process.env.GHOSTFOLIO_ACCOUNT_ID = req.body.GHOSTFOLIO_ACCOUNT_ID;
  if (typeof(req.body.GHOSTFOLIO_URL) !==  'undefined')
    process.env.GHOSTFOLIO_URL = req.body.GHOSTFOLIO_URL;
  if (typeof(req.body.GHOSTFOLIO_SECRET) !== 'undefined')
    process.env.GHOSTFOLIO_SECRET = req.body.GHOSTFOLIO_SECRET;

  console.log('GHOSTFOLIO_VALIDATE:', process.env.GHOSTFOLIO_VALIDATE);
  console.log('GHOSTFOLIO_IMPORT:', process.env.GHOSTFOLIO_IMPORT);
  console.log('GHOSTFOLIO_UPDATE_CASH:', process.env.GHOSTFOLIO_UPDATE_CASH);
  console.log('GHOSTFOLIO_ACCOUNT_ID:', process.env.GHOSTFOLIO_ACCOUNT_ID);
  console.log('GHOSTFOLIO_URL:', process.env.GHOSTFOLIO_URL);
  console.log('GHOSTFOLIO_SECRET:', process.env.GHOSTFOLIO_SECRET);

  try {
    
      // Determine convertor type and run conversion.
      const response = await new Promise(async (resolve, reject) => {
        createAndRunConverter(
          converter,
          inputFile,
          outputFolder,
          (data: any) => { resolve(data); },
          (err: any) => {
              console.log("[e] An error ocurred while processing.");
              console.log(`[e] ${err}`);
              reject(err);
          }
      );
    });

    // Delete the file after processing
    await fs.unlinkSync(file.path);

    // Return a response


    res.send({
      message: 'File uploaded and processed successfully',
      url: response?.outputFileName.replaceAll("\\", "/"),
    });
  } catch (error) {
    res.status(500).send('Error processing the file');
  }
});

// Serve the dist folder
app.use(express.static(path.join(__dirname, 'dist')));



// async function start() {
//   app.listen(port, () => {
//     console.log(`Server is running on port ${port}`);
//   });
// }

// start().catch((error) => {
//   console.error('Error starting the server:', error);
// });

// Manejador de conexión WebSocket
let clients: WebSocketServer[] = [];

// Save the original process.stdout.write method
const originalStdoutWrite = process.stdout.write;


const consoleLog = console.log;
const consoleWarn = console.warn;
const consoleError = console.error;

function sendLogToWS(log: string) {
  clients.forEach((client) => {
    client.send(log);
  });
}


// // Redirect process.stdout to console.log
// process.stdout.write = (...args) => {
//   sendLogToWS(args[0]);
//   return originalStdoutWrite(...args);
// };

// Redirigir la salida de consola al cliente
console.log = (...args) => {
  sendLogToWS(`LOG: ${args.join(' ')}`);
  consoleLog(...args);
};
console.warn = (...args) => {
  sendLogToWS(`WARN: ${args.join(' ')}`);
  consoleWarn(...args);
};
console.error = (...args) => {
  sendLogToWS(`ERROR: ${args.join(' ')}`);
  consoleError(...args);
};

wss.on('connection', (ws: WebSocketServer) => {
  console.log('Cliente conectado.');
  clients.push(ws);



  // // Escuchar mensajes del cliente
  // ws.on('message', (message) => {
  //   console.log('Mensaje recibido:', message.toString());

  //   // Responder al cliente
  //   ws.send(`Servidor recibió: ${message}`);
  // });

  // Manejar desconexión
  ws.on('close', () => {
    console.log('Cliente desconectado.');
    clients = clients.filter((client) => client !== ws);
  });
});



app.use("/", express.static(".output/public"));

// // Redirect all other routes to index.html (for SPA)
// app.get('*', (req, res) => {
//   res.redirect('/web');
// });





server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


// print hello on the console every 2 seconds
setInterval(() => {
  console.log('ping 🏓🏓 from server');
}, 20000);
