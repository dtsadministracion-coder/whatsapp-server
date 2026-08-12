const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
    
    // Obtener la versión de protocolo más reciente de WhatsApp
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Chrome (Linux)", "Chrome", "120.0.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            isConnected = false;
            console.log('Nuevo código QR generado en /qr');
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexión cerrada (Código ${statusCode}). Reconectando: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = '';
            console.log('✅ ¡WhatsApp conectado exitosamente!');
        }
    });
}

// Ruta para escanear el QR
app.get('/qr', async (req, res) => {
    if (isConnected) {
        return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center;margin-top:50px;">✅ WhatsApp ya está CONECTADO.</h2>');
    }
    
    if (!currentQR) {
        return res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">⏳ Generando código QR, por favor recarga en 5 segundos...</h2>');
    }

    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <div style="text-align:center;font-family:sans-serif;margin-top:40px;">
                <h2>Escanear QR con tu WhatsApp</h2>
                <img src="${qrImage}" style="width:300px;height:300px;" />
                <p>Abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generando la imagen del QR');
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

        res.json({ status: 'success', message: 'Mensaje enviado' });
    } catch (error) {
        res.status(500).json({ error: error.toString() });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
    connectToWhatsApp();
});
// MANTENER EL SERVIDOR DESPIERTO (Evita el Sleep Mode de Render)
const RENDER_URL = "https://whatsapp-server-cdfg.onrender.com";

setInterval(() => {
    fetch(`${RENDER_URL}/qr`)
        .then(() => console.log('🔄 Ping automático enviado para mantener el servidor despierto.'))
        .catch((err) => console.error('Error en autoping:', err.message));
}, 10 * 60 * 1000); // Se ejecuta cada 10 minutos (10 * 60 * 1000 ms)
