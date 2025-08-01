import {
  extractGeometry,
  filterElements,
  transformElements,
  extractQuantities,
  manageProperties,
  manageClassifications,
  spatialQuery,
  queryRelationships,
  performAnalysis,
  exportData,
  downloadExportedFile,
  loadIfcFile,
  IfcModel,
  getLastLoadedModel,
  extractGeometryWithGeom,
  runPythonScript,
} from "@/lib/ifc-utils";

// Add TypeScript interfaces at the top of the file
interface PropertyInfo {
  name: string;
  exists: boolean;
  value: any;
  psetName: string;
}

interface PropertyNodeElement {
  id: string;
  expressId?: number;
  type: string;
  properties?: {
    GlobalId?: string;
    Name?: string;
    [key: string]: any;
  };
  propertyInfo?: PropertyInfo;
  [key: string]: any;
}

// Helper function to safely convert values to JSON strings, avoiding cyclic references
function safeStringify(value: any): string {
  // Handle primitive values directly
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return String(value);

  // For objects, use a WeakSet to track objects that have been processed
  const seen = new WeakSet();

  // Custom replacer function for JSON.stringify that handles circular references
  const replacer = (key: string, value: any) => {
    // For non-objects, return the value directly
    if (typeof value !== "object" || value === null) return value;

    // For objects, check if we've seen it before to avoid cycles
    if (seen.has(value)) {
      return "[Circular Reference]";
    }

    // Mark this object as seen
    seen.add(value);
    return value;
  };

  try {
    return JSON.stringify(value, replacer);
  } catch (error) {
    console.warn("Error stringifying object:", error);
    return "[Complex Object]";
  }
}

// This is a simplified workflow executor
// In a real application, this would be more sophisticated with proper error handling and progress tracking
export class WorkflowExecutor {
  private nodes: any[] = [];
  private edges: any[] = [];
  private nodeResults: Map<string, any> = new Map();
  private isRunning = false;
  private abortController: AbortController | null = null;

  constructor(nodes: any[], edges: any[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  // Add getter for the final nodes list
  public getUpdatedNodes(): any[] {
    return this.nodes;
  }

  public async execute(): Promise<Map<string, any>> {
    if (this.isRunning) {
      throw new Error("Workflow is already running");
    }

    this.isRunning = true;
    this.nodeResults.clear();
    this.abortController = new AbortController();

    try {
      console.log("Starting workflow execution...");

      // Find all nodes that need to be processed (topological sort)
      const sortedNodes = this.topologicalSort();

      // Process each node in order
      for (const nodeId of sortedNodes) {
        console.log(`Processing node ${nodeId}`);
        await this.processNode(nodeId);
      }

      console.log("Workflow execution completed");
      return this.nodeResults;
    } catch (error) {
      console.error("Error executing workflow:", error);
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  public stop(): void {
    if (this.isRunning && this.abortController) {
      this.abortController.abort();
      this.isRunning = false;
    }
  }

  private findInputNodes(): string[] {
    const nodesWithIncomingEdges = new Set(
      this.edges.map((edge) => edge.target)
    );

    return this.nodes
      .filter((node) => !nodesWithIncomingEdges.has(node.id))
      .map((node) => node.id);
  }

  private async processNode(nodeId: string): Promise<any> {
    // If we already processed this node, return the cached result
    if (this.nodeResults.has(nodeId)) {
      return this.nodeResults.get(nodeId);
    }

    // Find the node
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Node with id ${nodeId} not found`);
    }

    // Get input values by processing upstream nodes
    const inputValues = await this.getInputValues(nodeId);

    // Process the node based on its type
    let result;
    switch (node.type) {
      case "ifcNode":
        // Log the request
        console.log("Processing ifcNode", { node });

        if (node.data.modelInfo) {
          // If we already have model info, use it
          console.log("Using modelInfo from node data", node.data.modelInfo);
          result = node.data.modelInfo;
        } else if (node.data.file) {
          try {
            // If there's a file in the node data, load it
            const file = node.data.file;
            console.log("Loading IFC file from node data", file.name);
            result = await loadIfcFile(file);

            // Store the result in the node data for future reference
            node.data.modelInfo = result;
          } catch (err) {
            console.error("Error loading IFC file:", err);
            throw new Error(
              `Failed to load IFC file: ${err instanceof Error ? err.message : String(err)
              }`
            );
          }
        } else {
          // Try to get the last loaded model
          const lastLoaded = getLastLoadedModel();
          if (lastLoaded) {
            // Use the last loaded model if available
            console.log(
              "Using last loaded model:",
              lastLoaded.id,
              "with",
              lastLoaded.elements.length,
              "elements"
            );
            result = lastLoaded;

            // Store it in the node data for future reference
            node.data.modelInfo = lastLoaded;
          } else {
            // No model info or file available - return empty structure
            console.warn(
              "No IFC model data available. Please load an IFC file first."
            );
            result = {
              id: `empty-model-${Date.now()}`,
              name: "No IFC Data",
              elements: [],
              errorMessage:
                "No IFC file loaded. Please load an IFC file first.",
            };
          }
        }

        // Make sure result is properly formatted with an elements array
        // Preserve original metadata if we have to wrap an array
        const originalModelData = result && typeof result === 'object' && !Array.isArray(result)
          ? { id: result.id, name: result.name, schema: result.schema, project: result.project }
          : { id: `model-${Date.now()}`, name: "Unknown IFC Model", schema: undefined, project: undefined };

        if (result && !result.elements && Array.isArray(result)) {
          // If result is just an array of elements, wrap it in a model object, preserving name etc.
          console.warn("IFC node result was an array, wrapping it in a model object.");
          result = {
            ...originalModelData, // Spread original metadata
            elements: result, // The array is the elements
            elementCounts: { unknown: result.length }, // Provide basic count
            totalElements: result.length,
          };
        } else if (result && typeof result === 'object' && !Array.isArray(result.elements)) {
          // If elements is not an array, initialize it as empty array
          result.elements = result.elements || [];
          // Ensure other metadata is present from originalModelData if missing in result
          result.name = result.name || originalModelData.name;
          result.id = result.id || originalModelData.id;
          result.schema = result.schema || originalModelData.schema;
          result.project = result.project || originalModelData.project;
        } else if (!result) {
          // Handle cases where result might be null/undefined
          result = {
            ...originalModelData,
            name: "No IFC Data",
            elements: [],
            errorMessage: "No IFC data processed."
          };
        }

        console.log(
          `IFC node processed with ${result.elements?.length || 0} elements named '${result.name}'` // Log name too
        );
        break;

      case "geometryNode":
        // Check if we should use actual geometry OR if there's a downstream GLB export
        const hasDownstreamGLB = this.hasDownstreamGLBExport(nodeId);
        const needsActualGeometry = node.data.properties?.useActualGeometry || hasDownstreamGLB;

        if (needsActualGeometry) {
          // Log why we're using actual geometry
          if (hasDownstreamGLB && !node.data.properties?.useActualGeometry) {
            console.log(`Automatically enabling geometry extraction for GLB export downstream from node ${nodeId}`);
          }

          // Use the full geometry extraction with web worker
          result = await this.executeGeometryNode(node);
        } else {
          // Use the simple extraction method
          result = extractGeometry(
            inputValues.input,
            node.data.properties?.elementType || "all",
            node.data.properties?.includeOpenings !== "false"
          );
        }
        break;

      case "filterNode":
        // Filter elements
        if (!inputValues.input) {
          console.warn(`No input provided to filter node ${nodeId}`);
          result = [];
        } else {
          const elementsToFilter = Array.isArray(inputValues.input)
            ? inputValues.input
            : inputValues.input.elements;

          result = filterElements(
            elementsToFilter || [],
            node.data.properties?.property || "",
            node.data.properties?.operator || "equals",
            node.data.properties?.value || ""
          );
        }
        break;

      case "transformNode":
        // Transform elements
        if (!inputValues.input) {
          console.warn(`No input provided to transform node ${nodeId}`);
          result = [];
        } else {
          result = transformElements(
            inputValues.input,
            [
              Number.parseFloat(node.data.properties?.translateX || 0),
              Number.parseFloat(node.data.properties?.translateY || 0),
              Number.parseFloat(node.data.properties?.translateZ || 0),
            ],
            [
              Number.parseFloat(node.data.properties?.rotateX || 0),
              Number.parseFloat(node.data.properties?.rotateY || 0),
              Number.parseFloat(node.data.properties?.rotateZ || 0),
            ],
            [
              Number.parseFloat(node.data.properties?.scaleX || 1),
              Number.parseFloat(node.data.properties?.scaleY || 1),
              Number.parseFloat(node.data.properties?.scaleZ || 1),
            ]
          );
        }
        break;

      case "quantityNode":
        // Extract quantities via worker
        if (!inputValues.input) {
          console.warn(`No input provided to quantity node ${nodeId}`);
          // Return a properly structured empty result that the watchNode can display safely
          result = {
            groups: { "Error": 0 },
            unit: "",
            total: 0,
            error: "No input data available"
          };
        } else {
          // The input should be the IfcModel object from the previous node
          const modelInput = inputValues.input as IfcModel;

          // Validate input has necessary properties for the worker call
          if (!modelInput || !modelInput.elements || !modelInput.name) {
            console.error("Invalid input to quantityNode: Missing model, elements, or name.", modelInput);
            // Return a properly structured empty result with error message
            result = {
              groups: { "Invalid Model": 0 },
              unit: "",
              total: 0,
              error: "Invalid input model"
            };
          } else {
            try {
              // Get quantityType and groupBy from node properties with defaults
              const quantityType = node.data.properties?.quantityType || "area";
              const groupBy = node.data.properties?.groupBy || "none";

              // Store the current settings back to the node data to ensure they persist
              // This is the key fix - we persist these values by updating the node data
              this.updateNodeDataInList(nodeId, {
                ...node.data,
                properties: {
                  ...node.data.properties,
                  quantityType: quantityType,
                  groupBy: groupBy
                }
              });

              // Await the async call to the worker via extractQuantities
              result = await extractQuantities(
                modelInput, // Pass the full model object
                quantityType,
                groupBy,
                undefined, // Placeholder for onProgress callback (optional)
                // --- Pass the callback to update node data with messageId ---
                (messageId: string) => {
                  // Update the node data, but keep our property settings
                  this.updateNodeDataInList(nodeId, {
                    ...node.data,
                    messageId: messageId,
                    properties: {
                      ...node.data.properties,
                      quantityType: quantityType,
                      groupBy: groupBy
                    }
                  });
                  console.log(`Stored messageId ${messageId} for quantity node ${nodeId}`);
                }
                // ---------------------------------------------------------
              );

              // Add the groupBy property to the result
              if (result && typeof result === 'object') {
                (result as any).groupBy = groupBy;
              }
            } catch (error) {
              console.error(`Error during quantity extraction for node ${nodeId}:`, error);
              // Return a properly structured error result that won't crash the UI
              result = {
                groups: { "Error": 0 },
                unit: "",
                total: 0,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          }
        }
        break;

      case "propertyNode":
        console.log("Processing propertyNode", { node, inputValues });

        // Add debugging to see the structure of the inputs
        if (!inputValues || !inputValues.input) {
          console.warn("No input provided to property node");
          result = { elements: [] };
          break;
        }

        // Determine if input is model object or elements array
        let nodeElements = [];

        if (Array.isArray(inputValues.input)) {
          nodeElements = inputValues.input;
          console.log(
            "Input is an array with",
            nodeElements.length,
            "elements"
          );
        } else if (inputValues.input && inputValues.input.elements) {
          nodeElements = inputValues.input.elements;
          console.log(
            "Input is a model object with",
            nodeElements.length,
            "elements"
          );
        } else {
          console.warn("Unexpected input format:", typeof inputValues.input);
          console.log("Input:", inputValues.input);
          result = { elements: [] };
          break;
        }

        // Always log the first element to understand structure
        if (nodeElements.length > 0) {
          console.log(
            "Sample element structure:",
            JSON.stringify(nodeElements[0], null, 2)
          );

          // Check if psets are available
          if (nodeElements[0].psets) {
            console.log(
              "Element has psets:",
              Object.keys(nodeElements[0].psets)
            );

            // Check for common wall psets
            if (nodeElements[0].psets["Pset_WallCommon"]) {
              console.log(
                "Pset_WallCommon:",
                nodeElements[0].psets["Pset_WallCommon"]
              );
            }
          }
        }

        // Extract properties from the node configuration
        const propertyName = node.data.properties?.propertyName || "";
        const action = node.data.properties?.action || "get";
        const propertyValue = node.data.properties?.propertyValue || "";
        const targetPset = node.data.properties?.targetPset || "any";

        // Determine where property values should come from
        let valueToUse = propertyValue;
        if (
          node.data.properties?.useValueInput &&
          inputValues.valueInput !== undefined
        ) {
          // Log the original input value for debugging
          console.log("Using value from input:", inputValues.valueInput);

          // Handle different input types for valueInput
          let inputValue = inputValues.valueInput;

          // If it's a complex object, try to extract a usable value
          if (typeof inputValue === "object" && inputValue !== null) {
            // Check if it's a property node result (has elements with propertyInfo)
            if (
              inputValue.elements &&
              Array.isArray(inputValue.elements) &&
              inputValue.elements[0]?.propertyInfo
            ) {
              console.log("Input value is a property node result");

              // Extract values from the property node results
              // If there's only one unique value, use that
              if (
                inputValue.uniqueValues &&
                inputValue.uniqueValues.length === 1
              ) {
                valueToUse = inputValue.uniqueValues[0];
                console.log("Using single unique value:", valueToUse);
              }
              // If there are multiple unique values, use the value from the first matching element
              else if (
                inputValue.elements.length > 0 &&
                inputValue.elements[0].propertyInfo?.exists
              ) {
                valueToUse = inputValue.elements[0].propertyInfo.value;
                console.log(
                  "Using first element's property value:",
                  valueToUse
                );
              }
              // Fallback to the raw input if we couldn't extract a better value
              else {
                valueToUse = inputValue;
                console.log(
                  "Using complex object as value (might cause issues)"
                );
              }
            }
            // Otherwise just use the input value
            else {
              valueToUse = inputValue;
            }
          } else {
            // For primitive types, use directly
            valueToUse = inputValue;
          }
        }

        console.log("Final value used for property:", valueToUse);

        // Manage properties using the utility function with options object
        const updatedElements = manageProperties(nodeElements, {
          action: action.toLowerCase(),
          propertyName,
          propertyValue: valueToUse,
          targetPset,
        });

        // Return the result with the updated elements
        result = { elements: updatedElements };

        // Also store the results in the node data for UI access
        node.data.results = updatedElements;
        break;

      case "watchNode":
        // Process data for watch node
        console.log("Processing watchNode", { node, inputValues });

        if (!inputValues || !inputValues.input) {
          console.log("No input provided to watch node");
          result = null;
          break;
        }

        let processedData = inputValues.input;

        // Get actual input type for display
        let inputType = "unknown";
        let itemCount = 0;

        if (Array.isArray(processedData)) {
          // Check if this is an array of IFC elements with geometry
          if (
            processedData.length > 0 &&
            processedData[0].type &&
            processedData[0].type.startsWith("Ifc") &&
            (processedData[0].geometry ||
              processedData[0].properties?.hasSimplifiedGeometry)
          ) {
            console.log(
              "Watch node received IFC elements with geometry:",
              processedData.length
            );

            // For geometry elements, create a more useful summary
            const geometryTypes = processedData.reduce((types, el) => {
              types[el.type] = (types[el.type] || 0) + 1;
              return types;
            }, {});

            // Process as a special geometry result
            processedData = {
              elements: processedData,
              elementCount: processedData.length,
              geometryTypes,
              hasGeometry: true,
            };

            inputType = "geometryResult";
            itemCount = processedData.elements.length;
          } else {
            // Regular array
            inputType = "array";
            itemCount = processedData.length;
          }
        } else if (processedData === null) {
          inputType = "null";
        } else if (processedData === undefined) {
          inputType = "undefined";
        } else if (typeof processedData === "object") {
          // Check if this is coming from a property node with propertyInfo
          if (
            processedData.elements &&
            Array.isArray(processedData.elements) &&
            processedData.elements[0]?.propertyInfo
          ) {
            // This is property node output - extract the relevant data
            const elements: PropertyNodeElement[] = processedData.elements;
            const elementsWithProperty = elements.filter(
              (e: PropertyNodeElement) => e.propertyInfo?.exists
            );

            // Get first element's property info to determine what we're dealing with
            const firstProperty = elementsWithProperty[0]?.propertyInfo;

            if (firstProperty) {
              // Find unique values
              const uniqueValues = [
                ...new Set(
                  elementsWithProperty
                    .map((e: PropertyNodeElement) => e.propertyInfo?.value)
                    .map((v: any) =>
                      typeof v === "object" ? safeStringify(v) : String(v)
                    )
                ),
              ].map((v: string) => {
                try {
                  return JSON.parse(v);
                } catch {
                  return v;
                }
              });

              // Create a more concise result focused on the property but including GlobalId for reference
              processedData = {
                propertyName: firstProperty.name,
                psetName: firstProperty.psetName,
                found: elementsWithProperty.length > 0,
                totalElements: elements.length,
                elementsWithProperty: elementsWithProperty.length,
                type: typeof firstProperty.value,
                uniqueValues,
                // Add element references with ids and GlobalIds
                elements: elementsWithProperty.map(
                  (e: PropertyNodeElement) => ({
                    id: e.id,
                    expressId: e.expressId,
                    type: e.type,
                    GlobalId: e.properties?.GlobalId,
                    Name: e.properties?.Name,
                    value: e.propertyInfo?.value,
                  })
                ),
              };

              inputType = "propertyResults";
              itemCount = elementsWithProperty.length;
            }
          }
          // ADD CHECK: Check if this is coming from a quantity node
          else if (processedData.groups && typeof processedData.unit === 'string' && typeof processedData.total === 'number') {
            inputType = "quantityResults";
            itemCount = Object.keys(processedData.groups).length; // Count the number of groups
          }
          // Fallback for generic objects
          else {
            inputType = "object";
            itemCount = Object.keys(processedData).length;
          }
        } else {
          inputType = typeof processedData;
        }

        // Update the node data with input information for display
        node.data.inputData = {
          type: inputType,
          value: processedData,
          count: itemCount,
        };

        // Watch nodes don't change the data, just pass it through
        result = processedData;
        break;

      case "classificationNode":
        // Manage classifications
        if (!inputValues.input) {
          console.warn(`No input provided to classification node ${nodeId}`);
          result = [];
        } else {
          result = manageClassifications(
            inputValues.input,
            node.data.properties?.system || "uniclass",
            node.data.properties?.action || "get",
            node.data.properties?.code || ""
          );
        }
        break;

      case "spatialNode":
        // Spatial query
        if (!inputValues.input) {
          console.warn(`No input provided to spatial node ${nodeId}`);
          result = [];
        } else {
          result = spatialQuery(
            inputValues.input,
            inputValues.reference || [],
            node.data.properties?.queryType || "contained",
            Number.parseFloat(node.data.properties?.distance || 1.0)
          );
        }
        break;

      case "relationshipNode":
        // Relationship query
        if (!inputValues.input) {
          console.warn(`No input provided to relationship node ${nodeId}`);
          result = [];
        } else {
          result = queryRelationships(
            inputValues.input,
            node.data.properties?.relationType || "containment",
            node.data.properties?.direction || "outgoing"
          );
        }
        break;

      case "analysisNode":
        // Analysis
        if (!inputValues.input) {
          console.warn(`No input provided to analysis node ${nodeId}`);
          result = {};
        } else {
          result = performAnalysis(
            inputValues.input,
            inputValues.reference || [],
            node.data.properties?.analysisType || "clash",
            {
              tolerance: Number.parseFloat(
                node.data.properties?.tolerance || 10
              ),
              metric: node.data.properties?.metric || "area",
            }
          );
        }
        break;

      case "pythonNode": {
        console.log("Processing pythonNode", { node, inputValues });

        // Python nodes can work with or without input
        const model = inputValues.input as IfcModel;

        // Validate we have a model with a file for the IFC context
        if (inputValues.input && (!model || !model.name)) {
          console.warn(`Invalid model provided to python node ${nodeId}`);
          result = null;
          break;
        }

        this.updateNodeDataInList(nodeId, {
          ...node.data,
          isLoading: true,
          progress: { percentage: 5, message: "Running Python..." },
          error: null,
        });

        try {
          // Pass input data and properties to the Python script
          // Use model if available, otherwise pass null (worker will handle it)
          result = await runPythonScript(
            model || null,
            node.data.properties?.code || "# No code provided\nresult = None",
            (p, m) => {
              this.updateNodeDataInList(nodeId, {
                ...node.data,
                isLoading: true,
                progress: { percentage: p, message: m || "Processing" },
              });
            },
            inputValues.input, // Pass the input data
            node.data.properties // Pass the node properties
          );
          this.updateNodeDataInList(nodeId, {
            ...node.data,
            isLoading: false,
            progress: null,
            result,
          });
        } catch (err) {
          this.updateNodeDataInList(nodeId, {
            ...node.data,
            isLoading: false,
            progress: null,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        break;
      }

      case "exportNode":
        // Export
        if (!inputValues.input) {
          console.warn(`No input provided to export node ${nodeId}`);
          result = "";
        } else {
          let exportInput = inputValues.input;

          // Check if this is GLB export and we need to extract geometry
          if (node.data.properties?.format === "glb") {
            console.log("GLB export detected - checking if geometry extraction is needed");

            // Check if input has geometry data
            const hasGeometry = this.checkIfInputHasGeometry(exportInput);

            if (!hasGeometry) {
              console.log("No geometry found in input - extracting geometry for GLB export");

              // Extract geometry from the input model
              try {
                exportInput = await this.extractGeometryForGLB(exportInput);
                console.log("Geometry extracted for GLB export:", exportInput?.length || 0, "elements");
              } catch (error) {
                console.error("Failed to extract geometry for GLB export:", error);
                // Continue with original input - let the export handle the error
              }
            }
          }

          result = await exportData(
            exportInput,
            node.data.properties?.format || "csv",
            node.data.properties?.fileName || "export"
          );
          if (
            result !== undefined &&
            node.data.properties?.format?.toLowerCase() !== "ifc"
          ) {
            downloadExportedFile(
              result,
              node.data.properties?.format || "csv",
              node.data.properties?.fileName || "export"
            );
          }
        }
        break;

      case "parameterNode":
        // Parameter
        result = node.data.properties?.value || "";
        break;

      case "viewerNode":
        // Process data for viewer node
        console.log("Processing viewerNode", { node, inputValues });

        if (!inputValues || !inputValues.input) {
          console.log("No input provided to viewer node");
          result = null;
          break;
        }

        // Store input data in the node for rendering
        node.data.inputData = inputValues.input;

        // Viewer nodes pass through their input
        result = inputValues.input;
        break;

      default:
        result = null;
    }

    // Cache the result
    this.nodeResults.set(nodeId, result);
    return result;
  }

  private async getInputValues(nodeId: string): Promise<Record<string, any>> {
    const inputEdges = this.edges.filter((edge) => edge.target === nodeId);
    const inputValues: Record<string, any> = {};

    for (const edge of inputEdges) {
      // Process the source node to get its output
      const sourceResult = await this.processNode(edge.source);

      // Map the output to the correct input based on the target handle
      if (edge.targetHandle === "input") {
        inputValues.input = sourceResult;
      } else if (edge.targetHandle === "reference") {
        inputValues.reference = sourceResult;
      } else if (edge.targetHandle === "valueInput") {
        inputValues.valueInput = sourceResult;
      } else {
        // Default case
        inputValues[edge.targetHandle || "input"] = sourceResult;
      }
    }

    return inputValues;
  }

  // Add a new method to perform topological sort of nodes
  private topologicalSort(): string[] {
    // Create a graph representation
    const graph: Record<string, string[]> = {};
    this.nodes.forEach((node) => {
      graph[node.id] = [];
    });

    // Add edges to the graph
    this.edges.forEach((edge) => {
      if (graph[edge.source]) {
        graph[edge.source].push(edge.target);
      }
    });

    // Perform topological sort
    const visited = new Set<string>();
    const tempVisited = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string) => {
      if (tempVisited.has(nodeId)) {
        throw new Error("Workflow contains a cycle, cannot execute");
      }

      if (!visited.has(nodeId)) {
        tempVisited.add(nodeId);

        // Visit all neighbors
        if (graph[nodeId]) {
          for (const neighbor of graph[nodeId]) {
            visit(neighbor);
          }
        }

        tempVisited.delete(nodeId);
        visited.add(nodeId);
        result.unshift(nodeId); // Add to the beginning
      }
    };

    // Visit all nodes
    this.nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    });

    return result;
  }

  // Helper to update node data in the internal list
  private updateNodeDataInList(nodeId: string, newData: any) {
    this.nodes = this.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: newData } : n
    );
    // Note: This only updates the executor's internal list.
    // ReactFlow's state needs to be updated separately after execution completes.
  }

  // Execute geometry node with actual geometry extraction
  private async executeGeometryNode(node: any): Promise<any> {
    const nodeId = node.id;
    console.log(`Executing geometry node with actual geometry for ${nodeId}`);

    // Get input values - find the input node (usually an IFC node)
    const inputValues = await this.getInputValues(nodeId);
    if (!inputValues.input) {
      throw new Error(`No input provided to geometry node ${nodeId}`);
    }

    const model = inputValues.input;
    if (!model || !model.file) {
      throw new Error(
        `Input to geometry node ${nodeId} is not a valid IFC model with file reference`
      );
    }

    const elementType = node.data.properties?.elementType || "all";
    const includeOpenings = node.data.properties?.includeOpenings !== "false";

    // Update node state to loading
    let updatedNodeData = {
      ...node.data,
      isLoading: true,
      progress: { percentage: 5, message: "Starting geometry extraction..." },
      error: null,
    };
    this.updateNodeDataInList(nodeId, updatedNodeData);

    try {
      // Define progress callback
      const progressCallback = (percentage: number, message?: string) => {
        this.updateNodeDataInList(nodeId, {
          ...updatedNodeData,
          isLoading: true,
          progress: { percentage, message: message || "Processing..." },
        });
      };

      // Extract geometry with the actual geometry approach
      const elements = await extractGeometryWithGeom(
        model,
        elementType,
        includeOpenings,
        progressCallback
      );

      // Update node with results
      updatedNodeData = {
        ...updatedNodeData,
        elements,
        model,
        isLoading: false,
        progress: null,
      };
      this.updateNodeDataInList(nodeId, updatedNodeData);

      // Return just the elements for workflow processing
      return elements.map((el) => {
        // If the element has a geometry property with a 'simplified' type,
        // include that in the direct properties for easier access in watch nodes
        if (el.geometry && el.geometry.type === "simplified") {
          return {
            ...el,
            properties: {
              ...el.properties,
              hasSimplifiedGeometry: true,
              dimensions: el.geometry.dimensions,
            },
          };
        }
        return el;
      });
    } catch (error) {
      console.error(
        `Error during geometry extraction for node ${nodeId}:`,
        error
      );

      // Update node with error state
      updatedNodeData = {
        ...updatedNodeData,
        isLoading: false,
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      };
      this.updateNodeDataInList(nodeId, updatedNodeData);

      // Rethrow the error
      throw error;
    }
  }

  // Helper method to check if there's a downstream GLB export from this node
  private hasDownstreamGLBExport(nodeId: string): boolean {
    const visited = new Set<string>();

    const checkDownstream = (currentNodeId: string): boolean => {
      if (visited.has(currentNodeId)) return false;
      visited.add(currentNodeId);

      // Find all edges that start from this node
      const outgoingEdges = this.edges.filter(edge => edge.source === currentNodeId);

      for (const edge of outgoingEdges) {
        const targetNode = this.nodes.find(n => n.id === edge.target);
        if (!targetNode) continue;

        // Check if this target node is an export node with GLB format
        if (targetNode.type === "exportNode" &&
          targetNode.data.properties?.format === "glb") {
          console.log(`Found downstream GLB export from geometry node ${nodeId}`);
          return true;
        }

        // Recursively check downstream nodes
        if (checkDownstream(edge.target)) {
          return true;
        }
      }

      return false;
    };

    return checkDownstream(nodeId);
  }

  // Helper method to check if input data has geometry
  private checkIfInputHasGeometry(input: any): boolean {
    if (!input) return false;

    // Check if it's an array of elements with geometry
    if (Array.isArray(input)) {
      return input.some((element: any) => element.geometry && element.geometry.vertices);
    }

    // Check if it's a model with elements that have geometry
    if (input.elements && Array.isArray(input.elements)) {
      return input.elements.some((element: any) => element.geometry && element.geometry.vertices);
    }

    return false;
  }

  // Helper method to extract geometry for GLB export
  private async extractGeometryForGLB(input: any): Promise<any> {
    // Determine if we have a model or elements array
    let model;
    if (Array.isArray(input)) {
      // If it's already an array, we need to find the source model
      // This is a limitation - we'll use the last loaded model
      const lastLoaded = getLastLoadedModel();
      if (!lastLoaded) {
        throw new Error("No IFC model available for geometry extraction");
      }
      model = lastLoaded;
    } else if (input.elements && Array.isArray(input.elements)) {
      // It's a model object
      model = input;
    } else {
      throw new Error("Invalid input format for geometry extraction");
    }

    // Extract geometry using the worker-based method
    console.log("Extracting geometry for GLB export from model:", model.name);

    // Use the same method as the geometry node
    const elements = await extractGeometryWithGeom(
      model,
      "all", // Extract all element types
      true,  // Include openings
      (progress, message) => {
        console.log(`GLB Geometry extraction: ${progress}% - ${message}`);
      }
    );

    return elements;
  }
}
