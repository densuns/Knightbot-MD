const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');
const isAdmin = require('../lib/isAdmin');
const { isSudo } = require('../lib/index');

const DATA_DIR = path.join(__dirname, '../data');
const POSTER_FILE = path.join(DATA_DIR, 'latest-poster.json');
const POSTER_IMAGE = path.join(DATA_DIR, 'latest-poster.jpg');

// Make sure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function posterCommand(sock, chatId, message) {
    try {
        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            '';

        const args = text.trim().split(/\s+/);
        const action = args[1]?.toLowerCase();

        /*
         * ADMIN CHECK
         * .poster set and .poster delete are admin-only in groups.
         * In private chat, only owner/sudo can manage the poster.
         */
        if (action === 'set' || action === 'delete') {
            const isGroup = chatId.endsWith('@g.us');
            const senderId = message.key.participant || message.key.remoteJid;

            if (isGroup) {
                const { isSenderAdmin, isBotAdmin } =
                    await isAdmin(sock, chatId, senderId);

                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: '⚠️ Please make the bot an admin first.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }

                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Only group admins can manage the poster.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
            } else {
                const senderIsSudo = await isSudo(senderId);

                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Only owner/sudo can manage the poster in private chat.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
            }
        }

        /*
         * .poster set
         * Admin replies to an image with .poster set
         */
        if (action === 'set') {
            const contextInfo =
                message.message?.extendedTextMessage?.contextInfo;

            const quotedMessage = contextInfo?.quotedMessage;

            if (!quotedMessage) {
                await sock.sendMessage(chatId, {
                    text: '❌ Reply to an event poster/image with `.poster set`.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }

            if (!quotedMessage.imageMessage) {
                await sock.sendMessage(chatId, {
                    text: '❌ The replied message must contain an image/poster.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }

            // Reconstruct the quoted message for Baileys
            const quoted = {
                key: {
                    remoteJid: chatId,
                    fromMe: false,
                    id: contextInfo.stanzaId,
                    participant: contextInfo.participant
                },
                message: quotedMessage
            };

            const imageBuffer = await sock.downloadMediaMessage(quoted);

            if (!imageBuffer) {
                throw new Error('Could not download poster image');
            }

            // Save image
            fs.writeFileSync(POSTER_IMAGE, imageBuffer);

            // Save poster information
            fs.writeFileSync(
                POSTER_FILE,
                JSON.stringify({
                    file: 'latest-poster.jpg',
                    savedAt: new Date().toISOString(),
                    setBy: message.key.participant || message.key.remoteJid
                }, null, 2)
            );

            await sock.sendMessage(chatId, {
                text: '✅ *Latest poster updated!*\n\n📢 Everyone can now use `.poster` to view it.',
                ...channelInfo
            }, { quoted: message });

            return;
        }

        /*
         * .poster delete
         */
        if (action === 'delete') {
            if (!fs.existsSync(POSTER_FILE)) {
                await sock.sendMessage(chatId, {
                    text: '📭 There is no saved poster to delete.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }

            if (fs.existsSync(POSTER_IMAGE)) {
                fs.unlinkSync(POSTER_IMAGE);
            }

            fs.unlinkSync(POSTER_FILE);

            await sock.sendMessage(chatId, {
                text: '🗑️ *Latest poster deleted successfully.*',
                ...channelInfo
            }, { quoted: message });

            return;
        }

        /*
         * .poster
         * Anyone can use this.
         */
        if (!fs.existsSync(POSTER_FILE) || !fs.existsSync(POSTER_IMAGE)) {
            await sock.sendMessage(chatId, {
                text: '📭 *No poster available right now.*\n\nAdmins can add one by replying to an image with `.poster set`.',
                ...channelInfo
            }, { quoted: message });
            return;
        }

        const posterBuffer = fs.readFileSync(POSTER_IMAGE);

        await sock.sendMessage(chatId, {
            image: posterBuffer,
            caption:
                '📢 *LATEST ANNOUNCEMENT / EVENT*\n\n' +
                '> Check the poster above for the latest information! 🎉',
            ...channelInfo
        }, { quoted: message });

    } catch (error) {
        console.error('Error in poster command:', error);

        await sock.sendMessage(chatId, {
            text: '❌ Failed to process the poster. Please try again.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = posterCommand;
