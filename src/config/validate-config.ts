import { plainToInstance } from 'class-transformer';
import { validateSync, validate } from 'class-validator';
import { ConfigSchema, McpServerConfig } from './config.schema';

/**
 * Validates the configuration object against the schema
 * This function is used by NestJS ConfigModule's validate option
 */
export function validateConfig(config: Record<string, unknown>) {
  // First, validate the main config structure
  const validatedConfig = plainToInstance(ConfigSchema, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: false, // Allow extra properties for flexibility
  });

  if (errors.length > 0) {
    const errorMessages = errors.map((error) => {
      const constraints = error.constraints
        ? Object.values(error.constraints).join(', ')
        : 'Unknown validation error';
      return `${error.property}: ${constraints}`;
    });

    throw new Error(
      `Configuration validation failed:\n${errorMessages.join('\n')}`,
    );
  }

  // Validate MCP servers dynamically
  const mcpConfig = config.mcp as any;
  if (mcpConfig?.servers) {
    validateMcpServers(mcpConfig.servers.text, 'text');
    validateMcpServers(mcpConfig.servers.voice, 'voice');
  }

  return validatedConfig;
}

/**
 * Validates dynamic MCP server configurations
 */
function validateMcpServers(
  servers: Record<string, any>,
  type: 'text' | 'voice',
) {
  if (!servers || typeof servers !== 'object') {
    throw new Error(`MCP ${type} servers must be an object`);
  }

  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.warn(`Warning: No MCP ${type} servers configured`);
    return;
  }

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    // Transform to McpServerConfig instance
    const server = plainToInstance(McpServerConfig, serverConfig, {
      enableImplicitConversion: true,
    });

    // Validate each server
    const serverErrors = validateSync(server, {
      skipMissingProperties: false,
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (serverErrors.length > 0) {
      const errorMessages = serverErrors.map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(', ')
          : 'Unknown validation error';
        return `  - ${error.property}: ${constraints}`;
      });

      throw new Error(
        `MCP ${type} server "${serverName}" validation failed:\n${errorMessages.join('\n')}`,
      );
    }

    // Validate URL format more strictly
    if (!serverConfig.url || typeof serverConfig.url !== 'string') {
      throw new Error(
        `MCP ${type} server "${serverName}": url must be a string`,
      );
    }

    // Validate enabled flag
    if (typeof serverConfig.enabled !== 'boolean') {
      throw new Error(
        `MCP ${type} server "${serverName}": enabled must be a boolean`,
      );
    }
  }
}
