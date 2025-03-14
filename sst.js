const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const port = process.env.PORT || 3000;

// AssemblyAI API Key
const API_KEY = "795e48ee75f64a1b8caf28dfba50e1a3";

// Middleware for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let lastAudioPath = null;

// Function to convert PCM to WAV
function convertPCMToWAV(pcmBuffer, outputFilePath) {
    return new Promise((resolve, reject) => {
        try {
            const writer = fs.createWriteStream(outputFilePath);
            const header = Buffer.alloc(44);

            // WAV file header format
            const fileSize = pcmBuffer.length + 36;
            header.write("RIFF", 0);
            header.writeUInt32LE(fileSize, 4);
            header.write("WAVE", 8);
            header.write("fmt ", 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20);
            header.writeUInt16LE(1, 22);
            header.writeUInt32LE(16000, 24); // Sample Rate (16kHz)
            header.writeUInt32LE(16000 * 1 * (8 / 8), 28); // Byte Rate (SampleRate * NumChannels * BitsPerSample/8)
            header.writeUInt16LE(1 * (8 / 8), 32); // Block Align (NumChannels * BitsPerSample/8)
            header.writeUInt16LE(8, 34); // Bits per sample
            header.write("data", 36);
            header.writeUInt32LE(pcmBuffer.length, 40);

            writer.write(header);
            writer.write(pcmBuffer);
            writer.end();

            writer.on('finish', () => resolve());
            writer.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

// **Endpoint to receive raw PCM audio from ESP32**
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No audio file uploaded');
    }

    lastAudioPath = path.join(__dirname, 'audio.wav');
    try {
        await convertPCMToWAV(req.file.buffer, lastAudioPath);
        res.send('Audio received and converted to WAV successfully');
    } catch (error) {
        console.error('Error converting PCM to WAV:', error);
        res.status(500).send('Error processing audio file');
    }
});

// Function to upload file to AssemblyAI
async function uploadFile(filePath) {
    try {
        const formData = new FormData();
        formData.append("audio", fs.createReadStream(filePath));

        const response = await axios.post("https://api.assemblyai.com/v2/upload", formData, {
            headers: {
                "Authorization": API_KEY,
                ...formData.getHeaders(),
            },
        });

        return response.data.upload_url;
    } catch (error) {
        console.error("File upload error:", error);
        throw new Error("File upload failed");
    }
}

// Function to transcribe audio using AssemblyAI
async function getTranscription(audioUrl) {
    try {
        const response = await axios.post(
            "https://api.assemblyai.com/v2/transcript",
            { audio_url: audioUrl },
            { headers: { Authorization: API_KEY, "Content-Type": "application/json" } }
        );
        return response.data.id;
    } catch (error) {
        console.error("Error requesting transcription:", error);
        throw new Error("Transcription request failed");
    }
}

// Function to fetch transcript text
async function fetchTranscriptText(transcriptId) {
    while (true) {
        await new Promise(res => setTimeout(res, 5000)); // Wait for processing

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

// Endpoint to process uploaded audio and get transcription
app.get('/gettext', async (req, res) => {
    if (!lastAudioPath) {
        return res.status(400).send('No audio file received yet');
    }

    try {
        const audioUrl = await uploadFile(lastAudioPath);
        const transcriptId = await getTranscription(audioUrl);
        const transcriptText = await fetchTranscriptText(transcriptId);

        res.json({ transcription: transcriptText });
    } catch (error) {
        console.error("Error in transcription:", error);
        res.status(500).send('Error processing transcription');
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
