require('dotenv').config();
const { Client, RichPresence } = require('discord.js-selfbot-v13');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const client = new Client({ checkUpdate: false });
const configPath = path.join(__dirname, 'config.json');

// Initialize config if not exists
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
        rpc: {
            applicationId: "",
            name: "Custom RPC",
            details: "Premium Mobile Dashboard",
            state: "Crafting a masterpiece",
            largeImageKey: "",
            largeImageText: "",
            smallImageKey: "",
            smallImageText: "",
            buttons: []
        }
    }, null, 4));
}

let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let isLogged = false;

// Token and Password from .env
const TOKEN = process.env.DISCORD_TOKEN;
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';

function saveConfig() {
    const configToSave = { ...config };
    delete configToSave.token;
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 4));
    io.emit('configUpdate', config);
}

async function updatePresence() {
    if (!isLogged || !config.rpc.applicationId) return;

    try {
        const r = new RichPresence(client)
            .setApplicationId(config.rpc.applicationId.trim())
            .setType('PLAYING')
            .setName(config.rpc.name || 'Custom RPC')
            .setDetails(config.rpc.details || '')
            .setState(config.rpc.state || '')
            .setStartTimestamp(Date.now());

        if (config.rpc.largeImageKey) {
            let key = config.rpc.largeImageKey.trim();
            if (!key.startsWith('http')) {
                key = key.toLowerCase();
            }
            r.setAssetsLargeImage(key);
            if (config.rpc.largeImageText) r.setAssetsLargeText(config.rpc.largeImageText.trim());
        }

        if (config.rpc.smallImageKey) {
            let key = config.rpc.smallImageKey.trim();
            if (!key.startsWith('http')) {
                key = key.toLowerCase();
            }
            r.setAssetsSmallImage(key);
            if (config.rpc.smallImageText) r.setAssetsSmallText(config.rpc.smallImageText.trim());
        }

        config.rpc.buttons.forEach(btn => {
            if (btn.label && btn.url) r.addButton(btn.label, btn.url);
        });

        client.user.setPresence({ activities: [r] });
        broadcastLog(`RPC Synced: ${config.rpc.name}`, "success");
    } catch (err) {
        broadcastLog("Presence Error: " + err.message, "error");
        console.error(err);
    }
}

function broadcastLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    io.emit('log', { message, type, timestamp });
}

const sanitize = (str) => typeof str === 'string' ? str.replace(/[<>]/g, '') : str;

io.on('connection', (socket) => {
    let isAuthenticated = false;

    socket.on('auth', (password) => {
        if (password === PASSWORD) {
            isAuthenticated = true;
            socket.emit('authSuccess', { config, isLogged, user: client.user ? { tag: client.user.tag, username: client.user.username } : null });
            broadcastLog("Authorized connection established", "info");
        } else {
            socket.emit('authError', "Invalid password");
            broadcastLog("Unauthorized access attempt blocked", "error");
        }
    });

    socket.on('updateConfig', (newConfig) => {
        if (!isAuthenticated) return;
        if (newConfig.rpc) {
            for (let key in newConfig.rpc) {
                if (typeof newConfig.rpc[key] === 'string') {
                    newConfig.rpc[key] = sanitize(newConfig.rpc[key]);
                }
            }
        }
        config = { ...config, ...newConfig };
        saveConfig();
        if (isLogged) updatePresence();
    });

    socket.on('stopPresence', () => {
        if (!isAuthenticated) return;
        if (isLogged) {
            client.user.setPresence({ activities: [], status: 'invisible' });
            setTimeout(() => {
                if (isLogged) client.user.setPresence({ activities: [], status: 'online' });
            }, 1000);
            broadcastLog("Presence Stopped & Cleared", "success");
        }
    });

    socket.on('login', () => {
        if (!isAuthenticated) return;
        if (!TOKEN) return broadcastLog("Token missing in .env!", "error");
        client.login(TOKEN).catch(err => {
            broadcastLog("Login failed: " + err.message, "error");
        });
    });

    socket.on('logout', () => {
        if (!isAuthenticated) return;
        client.destroy();
        isLogged = false;
        io.emit('statusUpdate', { isLogged: false, user: null });
        broadcastLog("Logged out", "info");
    });
});

client.on('ready', () => {
    isLogged = true;
    broadcastLog(`Logged in as ${client.user.tag}`, "success");
    io.emit('statusUpdate', { isLogged: true, user: { tag: client.user.tag, username: client.user.username } });
    updatePresence();
});

server.listen(PORT, () => {
    console.log(chalk.magenta(`\n  ✨ Mobile RPC Dashboard running at http://localhost:${PORT}\n`));
    if (TOKEN) {
        client.login(TOKEN).catch(err => {
            console.error("Auto-login failed:", err.message);
        });
    }
});
