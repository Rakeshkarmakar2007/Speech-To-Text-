import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { AssemblyAI } from 'assemblyai';
import wav from 'wav';

const app = express();
const port = 5000;

// AssemblyAI Client Setup
const client = new AssemblyAI({
    apiKey: "795e48ee75f64a1b8caf28dfba50e1a3"
});

// Middleware to handle raw audio file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let lastAudioPath = null;

// Function to convert raw PCM to WAV
function convertPCMToWAV(pcmBuffer, outputFilePath) {
    const writer = new wav.FileWriter(outputFilePath, {
        channels: 1,
        sampleRate: 16000,
        bitDepth: 8
    });

    writer.write(pcmBuffer);
    writer.end();
}

// Endpoint to receive raw PCM audio from ESP32
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file received');
    }

    console.log('Audio data received:', req.file.buffer.length, 'bytes');

    // Save PCM as WAV
    lastAudioPath = path.join(__dirname, 'audio.wav');
    convertPCMToWAV(req.file.buffer, lastAudioPath);

    res.send('Audio received and converted to WAV successfully');
});

// Endpoint to transcribe the WAV file using AssemblyAI
app.get('/gettext', async (req, res) => {
    if (!lastAudioPath) {
        return res.send('No audio file received yet');
    }

    try {
        // Upload WAV file to AssemblyAI
        const uploadResponse = await client.files.upload(fs.createReadStream(lastAudioPath));
        const transcript = await client.transcripts.transcribe({ audio_url: uploadResponse.upload_url });

        console.log('Transcription:', transcript.text);
        res.send(transcript.text);
    } catch (error) {
        console.error('Error during transcription:', error);
        res.status(500).send('Error processing transcription');
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
