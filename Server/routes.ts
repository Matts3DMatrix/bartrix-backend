import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { insertProjectSchema, updateProjectSchema, insertActivitySchema } from "@shared/schema";

// Configure multer for file uploads
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.stl', '.step', '.obj', '.ply'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only STL, STEP, OBJ, and PLY files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all projects with optional email filter
  app.get("/api/projects", async (req, res) => {
    try {
      const { email } = req.query;
      let projects;
      
      if (email) {
        projects = await storage.getProjectsByEmail(email as string);
      } else {
        projects = await storage.getAllProjects();
      }
      
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  // Get single project
  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  // Create new project
  app.post("/api/projects", async (req, res) => {
    try {
      const validatedData = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(validatedData);
      
      // Create initial activity
      await storage.createActivity({
        projectId: project.id,
        description: `Project "${project.title}" created`,
        type: "created"
      });
      
      res.status(201).json(project);
    } catch (error) {
      res.status(400).json({ message: "Invalid project data", error: error });
    }
  });

  // Update project
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const validatedData = updateProjectSchema.parse(req.body);
      const project = await storage.updateProject(req.params.id, validatedData);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      res.json(project);
    } catch (error) {
      res.status(400).json({ message: "Invalid update data", error: error });
    }
  });

  // Upload file to project
  app.post("/api/projects/:id/upload", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const updatedProject = await storage.updateProject(req.params.id, {
        status: "file_uploaded"
      });

      // Update the file info separately since these aren't part of the update schema
      const projectWithFile = await storage.getProject(req.params.id);
      if (projectWithFile) {
        projectWithFile.fileName = req.file.originalname;
        projectWithFile.fileSize = req.file.size.toString();
        projectWithFile.fileType = req.file.mimetype;
        projectWithFile.filePath = req.file.path;
        projectWithFile.uploadedAt = new Date();
      }

      // Create activity
      await storage.createActivity({
        projectId: req.params.id,
        description: `File "${req.file.originalname}" uploaded`,
        type: "upload"
      });

      res.json(projectWithFile);
    } catch (error) {
      res.status(500).json({ message: "File upload failed", error: error });
    }
  });

  // Get file (with access control)
  app.get("/api/projects/:id/file", async (req, res) => {
    try {
      const { download } = req.query;
      const project = await storage.getProject(req.params.id);
      
      if (!project || !project.filePath) {
        return res.status(404).json({ message: "File not found" });
      }

      // Check if download is allowed (both parties approved)
      if (download === 'true' && (project.buyerApproved !== 'true' || project.sellerApproved !== 'true')) {
        return res.status(403).json({ message: "Download not authorized. Project must be completed by both parties." });
      }

      if (!fs.existsSync(project.filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      if (download === 'true') {
        res.download(project.filePath, project.fileName || 'model');
      } else {
        // For preview, just return file info and basic metadata
        res.json({
          fileName: project.fileName,
          fileSize: project.fileSize,
          fileType: project.fileType,
          uploadedAt: project.uploadedAt,
          downloadAllowed: project.buyerApproved === 'true' && project.sellerApproved === 'true'
        });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to access file" });
    }
  });

  // Simulate payment deposit
  app.post("/api/projects/:id/deposit", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const updatedProject = await storage.updateProject(req.params.id, {
        paymentStatus: "held",
        status: "payment_deposited"
      });

      await storage.createActivity({
        projectId: req.params.id,
        description: `Escrow payment of $${project.amount} deposited`,
        type: "payment"
      });

      res.json(updatedProject);
    } catch (error) {
      res.status(500).json({ message: "Payment deposit failed" });
    }
  });

  // Buyer approval/revision request
  app.post("/api/projects/:id/buyer-action", async (req, res) => {
    try {
      const { action } = req.body; // "approve" or "request_revision"
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const updates: any = {
        buyerApproved: action === "approve" ? "true" : "revision_requested",
        status: action === "approve" ? "under_review" : "revision_requested"
      };

      const updatedProject = await storage.updateProject(req.params.id, updates);

      const description = action === "approve" 
        ? "Buyer approved the project"
        : "Buyer requested revisions";

      await storage.createActivity({
        projectId: req.params.id,
        description,
        type: "review"
      });

      res.json(updatedProject);
    } catch (error) {
      res.status(500).json({ message: "Action failed" });
    }
  });

  // Seller approval
  app.post("/api/projects/:id/seller-approve", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if buyer also approved
      const shouldComplete = project.buyerApproved === "true";

      const updates: any = {
        sellerApproved: "true",
        status: shouldComplete ? "completed" : "under_review",
        paymentStatus: shouldComplete ? "released" : project.paymentStatus
      };

      const updatedProject = await storage.updateProject(req.params.id, updates);

      const description = shouldComplete
        ? "Project completed - payment released to seller"
        : "Seller approved the project completion";

      await storage.createActivity({
        projectId: req.params.id,
        description,
        type: shouldComplete ? "completion" : "approval"
      });

      res.json(updatedProject);
    } catch (error) {
      res.status(500).json({ message: "Approval failed" });
    }
  });

  // Get project activities
  app.get("/api/projects/:id/activities", async (req, res) => {
    try {
      const activities = await storage.getActivitiesByProject(req.params.id);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Get recent activities for dashboard
  app.get("/api/activities/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const activities = await storage.getRecentActivities(limit);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent activities" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
