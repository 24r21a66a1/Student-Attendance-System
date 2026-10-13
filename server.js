
require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3000;

// 1. Middleware
app.use(express.json());

// 2. MongoDB connection from .env
const MONGO_URI = process.env.MONGO_URI;

// 3. Student schema
const studentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    roll: { type: String, required: true, unique: true, trim: true },
    parentEmail: { type: String, default: "", trim: true },
    attendance: [
        {
            date: String,
            status: {
                type: String,
                enum: ["Present", "Absent"]
            }
        }
    ]
});

const Student = mongoose.model("Student", studentSchema);

// 4. Gmail transporter
function createTransporter() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return null;
    }

    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}

// 5. Display website
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// 6. Get all students
app.get("/api/students", async (req, res) => {
    try {
        const students = await Student.find().sort({ roll: 1 });
        res.json(students);
    } catch (err) {
        console.error("Load students error:", err.message);
        res.status(500).json({
            message: "Could not load students."
        });
    }
});

// 7. Add student
app.post("/api/students", async (req, res) => {
    try {
        const { name, roll, parentEmail } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            typeof roll !== "string" ||
            !roll.trim()
        ) {
            return res.status(400).json({
                message: "Student name and roll number are required."
            });
        }

        const email =
            typeof parentEmail === "string" ? parentEmail.trim() : "";

        const student = await Student.create({
            name: name.trim(),
            roll: roll.trim(),
            parentEmail: email
        });

        res.status(201).json({
            message: "Student added successfully.",
            student
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                message: "This roll number already exists."
            });
        }

        console.error("Add student error:", err.message);
        res.status(500).json({
            message: "Could not add student."
        });
    }
});

// 8. Mark attendance and email if absent
app.post("/api/attendance", async (req, res) => {
    try {
        const { studentId, status } = req.body;

        if (!mongoose.isValidObjectId(studentId)) {
            return res.status(400).json({
                message: "Invalid student ID."
            });
        }

        if (!["Present", "Absent"].includes(status)) {
            return res.status(400).json({
                message: "Choose Present or Absent."
            });
        }

        const student = await Student.findById(studentId);

        if (!student) {
            return res.status(404).json({
                message: "Student not found."
            });
        }

        const today = new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata"
        });

        // Save or update today's attendance
        const record = student.attendance.find(
            item => item.date === today
        );

        if (record) {
            record.status = status;
        } else {
            student.attendance.push({
                date: today,
                status
            });
        }

        // Save attendance before sending email
        await student.save();

        let notification = "Attendance saved successfully.";

        if (status === "Absent") {
            if (!student.parentEmail) {
                notification =
                    "Attendance saved, but no email address was entered.";
            } else {
                const transporter = createTransporter();

                if (!transporter) {
                    notification =
                        "Attendance saved, but Gmail is not configured.";
                } else {
                    try {
                        await transporter.sendMail({
                            from: process.env.EMAIL_USER,
                            to: student.parentEmail,
                            subject: "Student Absence Notification",
                            text:
                                `Hello,\n\n` +
                                `Student ${student.name} ` +
                                `(Roll Number: ${student.roll}) ` +
                                `was marked absent on ${today}.\n\n` +
                                `This is an attendance notification ` +
                                `from the Student Attendance System.`
                        });

                        notification =
                            "Attendance saved and email notification sent.";
                    } catch (emailError) {
                        console.error(
                            "Email error:",
                            emailError.message
                        );

                        notification =
                            "Attendance saved, but email failed. Check Gmail settings.";
                    }
                }
            }
        }

        res.json({ message: notification });
    } catch (err) {
        console.error("Attendance error:", err.message);
        res.status(500).json({
            message: "Could not save attendance."
        });
    }
});

// 9. Connect to MongoDB once and start server
async function startServer() {
    try {
        if (!MONGO_URI) {
            throw new Error("MONGO_URI is missing from .env");
        }

        await mongoose.connect(MONGO_URI);

        console.log("MongoDB connected successfully");

        app.listen(PORT, () => {
            console.log(`Open http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
    }
}

startServer();
