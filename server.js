const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

let sock;
let currentQR = '';
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            isConnected = false;
            console.log('Nuevo código QR disponible en /qr');
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexión cerrada (Código ${statusCode}). Reconectando: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = '';
            console.log('✅ ¡WhatsApp vinculado y conectado!');
        }
    });
}

// Ruta para ver el QR
app.get('/qr', async (req, res) => {
    if (isConnected) {
        return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center;margin-top:50px;">✅ WhatsApp ya está CONECTADO.</h2>');
    }
    
    if (!currentQR) {
        return res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">⏳ Generando código QR... Recarga la página en 5 segundos.</h2>');
    }

    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <div style="text-align:center;font-family:sans-serif;margin-top:40px;">
                <h2>Escanear QR con WhatsApp</h2>
                <img src="${qrImage}" style="width:300px;height:300px;" />
                <p>Abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error al generar la imagen del QR');
    }
});

// Ruta para enviar mensajes
app.post('/send-message', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(500).json({ error: 'WhatsApp no está conectado. Revisa /qr' });
        }

        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ error: 'Faltan parámetros: phone o message' });
        }

        const formattedPhone = phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(formattedPhone, { text: message });

        res.json({ status: 'success', message: 'Enviado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.toString() });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
    connectToWhatsApp();
});
