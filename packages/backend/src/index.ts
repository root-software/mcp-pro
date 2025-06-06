// Main entry point for the backend application
import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { initializeDatabase } from './config/database';
// Import controller and service classes only (not instances)
import { ManagementController } from './controllers/ManagementController';
import { MarketplaceController } from './controllers/MarketplaceController';
import { TrafficController } from './controllers/TrafficController';
import { McpGatewayController } from './controllers/McpGatewayController';
import { ManagedServerService } from './services/ManagedServerService';
import { ApiKeyService } from './services/ApiKeyService';
import { TrafficMonitoringService } from './services/TrafficMonitoringService';
import { MarketplaceService } from './services/MarketplaceService';
import { CentralGatewayMCPService } from './services/CentralGatewayMCPService';

dotenv.config(); // Load environment variables from .env file

const app: Express = express();
const port: number = parseInt(process.env.PORT ? process.env.PORT : '') || 3001;

// Middleware
// app.use(express.json()); // REMOVED: Global JSON parser - will be applied selectively
// app.use(express.urlencoded({ extended: true })); // REMOVED: Global URLencoded parser - will be applied selectively

// Basic CORS middleware (consider using the 'cors' package for more options)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*'); // Allow all origins (adjust for production)
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    return res.status(200).json({});
  }
  next();
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('MCP Pro Backend is running!');
});

// Global error handler (simple example)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

async function main() {
  // Initialize database
  try {
    await initializeDatabase();
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize the database:', error);
    process.exit(1); // Exit if DB connection fails
  }

  // Instantiate services after DB is ready
  const apiKeyService = new ApiKeyService();
  const trafficMonitoringService = new TrafficMonitoringService();
  
  // 1. Instantiate ManagedServerService (no callback in constructor anymore)
  const managedServerService = new ManagedServerService(process.env.NODE_ENV === 'development');

  // 2. Instantiate CentralGatewayMCPService
  // Its constructor will call managedServerService.setServerInitiatedMessageCallback()
  const centralGatewayService = new CentralGatewayMCPService(
    managedServerService, 
    apiKeyService,
    trafficMonitoringService
  );  // 3. Instantiate McpGatewayController (which will automatically set up the SSE delegate)
  
  // Ensure CentralGatewayMCPService is initialized before controllers that depend on its transport
  try {
    await centralGatewayService.initialize();
    console.log(`[Index] CentralGatewayMCPService (Instance: ${centralGatewayService.instanceId}) initialized. Service Ready: ${centralGatewayService.isReady()}`);
    if (!centralGatewayService.isReady()) {
      console.error(`[Index] FATAL: CentralGatewayMCPService (Instance: ${centralGatewayService.instanceId}) .initialize() completed but service is NOT ready. Aborting.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`[Index] Failed to initialize CentralGatewayMCPService (Instance: ${centralGatewayService.instanceId}):`, error);
    process.exit(1); // Exit if gateway service essential for MCP routes fails
  }

  const mcpGatewayController = new McpGatewayController(centralGatewayService);

  const marketplaceService = new MarketplaceService(managedServerService);

  // Instantiate other controllers with their dependencies
  const managementController = new ManagementController(managedServerService, apiKeyService);
  const marketplaceController = new MarketplaceController(marketplaceService);
  const trafficController = new TrafficController(trafficMonitoringService);
  // mcpGatewayController is already instantiated

  // Import routes and inject controllers
  const managementApiRoutes = require('./routes/managementApi').default(managementController, marketplaceController, trafficController);
  const mcpApiRoutes = require('./routes/mcpApi').default(mcpGatewayController);

  // API Routes
  // Apply body parsers only to the management API routes
  app.use('/api', express.json(), express.urlencoded({ extended: true }), managementApiRoutes);
  app.use('/mcp', mcpApiRoutes);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server is listening on port ${port}`);
  });
}

main().catch((e) => {
  console.error('Failed to start the backend server:', e);
  process.exit(1);
});
