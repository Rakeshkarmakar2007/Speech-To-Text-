const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = "795e48ee75f64a1b8caf28dfba50e1a3";

let pcmFilePath = path.join(__dirname, 'audio.pcm');
let wavFilePath = path.join(__dirname, 'audio.wav');

// Ensure PCM file is empty before new recording starts
fs.writeFileSync(pcmFilePath, '');

// **1️⃣ Receive Chunked PCM Audio from ESP32**
app.post('/upload', (req, res) => {
    const writeStream = fs.createWriteStream(pcmFilePath, { flags: 'a' });

    req.on('data', (chunk) => {
        writeStream.write(chunk);
    });

    req.on('end', () => {
        writeStream.end();
        console.log("PCM Audio chunk received and appended.");
        res.send("Audio chunk received.");
    });

    req.on('error', (err) => {
        console.error("Error receiving PCM audio:", err);
        res.status(500).send("Error receiving audio.");
    });
});

// **2️⃣ Convert PCM to WAV**
function convertPCMToWAV() {
    return new Promise((resolve, reject) => {
        try {
            const pcmBuffer = fs.readFileSync(pcmFilePath);
            const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);

            // WAV Header
            wavBuffer.write("RIFF", 0);
            wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
            wavBuffer.write("WAVE", 8);
            wavBuffer.write("fmt ", 12);
            wavBuffer.writeUInt32LE(16, 16);
            wavBuffer.writeUInt16LE(1, 20); // Audio format (PCM)
            wavBuffer.writeUInt16LE(1, 22); // Num channels (Mono)
            wavBuffer.writeUInt32LE(16000, 24); // Sample rate (16kHz)
            wavBuffer.writeUInt32LE(16000 * 1 * (16 / 8), 28); // Byte rate
            wavBuffer.writeUInt16LE(1 * (16 / 8), 32); // Block align
            wavBuffer.writeUInt16LE(16, 34); // Bits per sample (16-bit)
            wavBuffer.write("data", 36);
            wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
            pcmBuffer.copy(wavBuffer, 44);

            fs.writeFileSync(wavFilePath, wavBuffer);
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// **3️⃣ Endpoint to Convert PCM to WAV**
app.get('/convert', async (req, res) => {
    try {
        await convertPCMToWAV();
        res.send("PCM file converted to WAV successfully.");
    } catch (error) {
        console.error("Conversion error:", error);
        res.status(500).send("Error converting PCM to WAV.");
    }
});

// **4️⃣ Play the Converted Audio**
app.get('/play-audio', (req, res) => {
    if (!fs.existsSync(wavFilePath)) {
        return res.status(404).send('No WAV file found. Convert PCM first.');
    }

    res.sendFile(wavFilePath, { headers: { 'Content-Type': 'audio/wav' } });
});

// **5️⃣ Upload File to AssemblyAI**
async function uploadFile(filePath) {
    const formData = new FormData();
    formData.append("audio", fs.createReadStream(filePath));

    const response = await axios.post("https://api.assemblyai.com/v2/upload", formData, {
        headers: { "Authorization": API_KEY, ...formData.getHeaders() },
    });

    return response.data.upload_url;
}

// **6️⃣ Request Transcription**
async function getTranscription(audioUrl) {
    const response = await axios.post(
        "https://api.assemblyai.com/v2/transcript",
        { audio_url: audioUrl },
        { headers: { Authorization: API_KEY, "Content-Type": "application/json" } }
    );

    return response.data.id;
}

// **7️⃣ Fetch Transcription Result**
async function fetchTranscriptText(transcriptId) {
    while (true) {
        await new Promise(res => setTimeout(res, 5000));

        const response = await axios.get(
            `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
            { headers: { Authorization: `Bearer ${API_KEY}` } }
        );

        if (response.data.status === "completed") {
            return response.data.text;
        } else if (response.data.status === "failed") {
            throw new Error("Transcription failed");
        }
    }
}

// **8️⃣ Transcribe Audio and Get Text**
app.get('/gettext', async (req, res) => {
    if (!fs.existsSync(wavFilePath)) {
        return res.status(400).send('No audio file received yet.');
    }

    try {
        const audioUrl = await uploadFile(wavFilePath);
        const transcriptId = await getTranscription(audioUrl);
        const transcriptText = await fetchTranscriptText(transcriptId);

        res.json({
            transcription: transcriptText,
            play_audio_url: `http://localhost:${port}/play-audio`
        });
    } catch (error) {
        console.error("Transcription error:", error);
        res.status(500).send('Error processing transcription.');
    }
});

// **Start Server**
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
