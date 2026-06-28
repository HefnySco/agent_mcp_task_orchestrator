/**
 * Response utility for consistent MCP tool output format
 */

export interface ToolResponseParams {
  success: boolean;
  data?: any;
  displayOutput?: string;
  error?: { code: string; message: string } | null;
  metadata?: Record<string, any>;
}

export interface ToolResponse {
  success: boolean;
  data: any;
  displayOutput: string;
  error: { code: string; message: string } | null;
  metadata: {
    tool: string;
    timestamp: string;
  };
}

/**
 * Create a standardized tool response with consistent JSON structure
 * 
 * @param params - Response parameters
 * @param toolName - Name of the tool being called
 * @returns MCP-formatted response object
 */
export function createToolResponse(
  params: ToolResponseParams,
  toolName: string
): { content: Array<{ type: string; text: string }> } {
  const {
    success,
    data = null,
    displayOutput = '',
    error = null,
    metadata = {}
  } = params;

  const response: ToolResponse = {
    success,
    data,
    displayOutput,
    error,
    metadata: {
      tool: toolName,
      timestamp: new Date().toISOString(),
      ...metadata
    }
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }
    ]
  };
}

/**
 * Create a success response
 */
export function createSuccessResponse(
  data: any,
  displayOutput: string,
  toolName: string,
  metadata?: Record<string, any>
): { content: Array<{ type: string; text: string }> } {
  return createToolResponse({
    success: true,
    data,
    displayOutput,
    error: null,
    metadata
  }, toolName);
}

/**
 * Create an error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  displayOutput: string,
  toolName: string,
  metadata?: Record<string, any>
): { content: Array<{ type: string; text: string }> } {
  return createToolResponse({
    success: false,
    data: null,
    displayOutput,
    error: { code, message },
    metadata
  }, toolName);
}
