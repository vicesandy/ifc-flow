"use client";

import { memo, useRef, useEffect, useState, useCallback } from "react";
import {
  Handle,
  Position,
  useReactFlow,
  NodeProps,
} from "reactflow";
import { CuboidIcon as Cube, Loader2, AlertCircle, CheckCircle, Focus, MousePointer2 } from "lucide-react";
import { IfcViewer } from "@/lib/ifc/viewer-utils";
import { ViewerNodeData as BaseViewerNodeData } from "./node-types";
import { useViewerFocus } from "@/components/contexts/viewer-focus-context";

// Extend the base ViewerNodeData with additional properties
interface ExtendedViewerNodeData extends BaseViewerNodeData {
  inputData?: any;
  width?: number;
  height?: number;
}

export const ViewerNode = memo(
  ({ data, id, selected, isConnectable }: NodeProps<ExtendedViewerNodeData>) => {
    const viewerRef = useRef<HTMLDivElement>(null);
    const [viewer, setViewer] = useState<IfcViewer | null>(null);
    const [elementCount, setElementCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [loadedFileIdentifier, setLoadedFileIdentifier] = useState<string | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const { setNodes } = useReactFlow();
    const { focusedViewerId, setFocusedViewerId } = useViewerFocus();

    // Default sizes with fallback values
    const width = data.width || 220;
    const height = data.height || 200;
    const viewerHeight = Math.max(height - 60, 100); // Subtract space for header and footer

    // Check if this viewer is in focus mode
    const isInFocusMode = focusedViewerId === id;

    // Handle double-click to enter 3D focus mode
    const handleViewerDoubleClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isInFocusMode && elementCount > 0 && !errorMessage && !isLoading) {
        setFocusedViewerId(id);
      }
    }, [id, isInFocusMode, elementCount, errorMessage, isLoading, setFocusedViewerId]);

    // Keyboard event handling when in focus mode
    useEffect(() => {
      if (!isInFocusMode) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent canvas shortcuts when viewer is in focus
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'].includes(e.key)) {
          e.stopPropagation();
        }
      };

      document.addEventListener('keydown', handleKeyDown, true);
      return () => {
        document.removeEventListener('keydown', handleKeyDown, true);
      };
    }, [isInFocusMode]);

    // Handle window mouse events for resizing
    const startResize = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = width;
        const startHeight = height;

        const onMouseMove = (e: MouseEvent) => {
          const newWidth = Math.max(180, startWidth + e.clientX - startX);
          const newHeight = Math.max(150, startHeight + e.clientY - startY);

          setNodes((nodes) =>
            nodes.map((node) => {
              if (node.id === id) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    width: newWidth,
                    height: newHeight,
                  },
                };
              }
              return node;
            })
          );
        };

        const onMouseUp = () => {
          setIsResizing(false);
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      },
      [id, width, height, setNodes]
    );

    // Create and clean up the viewer
    useEffect(() => {
      if (!viewerRef.current) return;

      // Create a new viewer instance
      const newViewer = new IfcViewer(viewerRef.current, {
        backgroundColor: "#f5f5f5",
        showGrid: true,
        showAxes: true,
      });

      setViewer(newViewer);

      // Clean up on unmount
      return () => {
        if (newViewer) {
          newViewer.dispose();
        }
        setViewer(null);
      };
    }, []);

    // Update viewer when size changes
    useEffect(() => {
      if (viewer && viewerRef.current) {
        // Update the container size - this preserves current camera position
        viewer.resize();
      }
    }, [width, height, viewer]);

    // Handle input data changes - Expecting File object
    useEffect(() => {
      console.log("ViewerNode: Input data effect triggered.", { hasViewer: !!viewer, inputData: data.inputData });
      const fileInput = data.inputData?.file;
      // Create an identifier for the potential new file (or null if no valid file)
      const inputFileIdentifier = fileInput instanceof File ? `${fileInput.name}_${fileInput.lastModified}_${fileInput.size}` : null;

      if (!viewer) {
        console.log("ViewerNode: Viewer instance not ready yet.");
        return;
      }

      // --- Handle invalid or removed input ---
      if (!fileInput || !(fileInput instanceof File) || !fileInput.name.toLowerCase().endsWith(".ifc")) {
        // Only clear and reset state if something *was* loaded previously and input is now invalid/gone
        if (loadedFileIdentifier !== null) {
          console.log("ViewerNode: Invalid or missing input, clearing viewer and resetting state.");
          viewer.clear();
          setLoadedFileIdentifier(null);
          setElementCount(0);
          setIsLoading(false);
          setErrorMessage("Invalid input: Expected IFC file."); // Show error message
        } else {
          // If nothing was loaded and input is invalid/missing, just ensure viewer is clear.
          // viewer.clear(); // clear() is likely called by previous step already, maybe redundant
          setErrorMessage(null); // No error if nothing was expected yet
          setIsLoading(false);
          setElementCount(0);
        }
        return; // Stop processing if input is invalid
      }

      // --- Input is a valid IFC File object ---
      const file = fileInput;
      const newFileIdentifier = inputFileIdentifier; // Already calculated above

      // *** Check if this file is the same as the one already loaded ***
      if (newFileIdentifier === loadedFileIdentifier) {
        console.log(`ViewerNode: File ${file.name} (${newFileIdentifier}) is already loaded. Skipping reload.`);
        // Ensure loading/error states are correct if we skip loading
        setIsLoading(false);
        setErrorMessage(null);
        // Keep elementCount > 0 to show "Model Loaded"
        setElementCount(e => e > 0 ? e : 1); // Set to 1 if it was 0
        return; // Don't reload the same file
      }

      // --- Proceed with loading the new file ---
      console.log(`ViewerNode: New file detected (${file.name}), initiating load.`);
      setIsLoading(true);
      setErrorMessage(null);
      setElementCount(0); // Reset count indicator during load

      viewer.loadIfc(file)
        .then(() => {
          console.log(`IFC loaded successfully in viewer node: ${file.name}`);
          setElementCount(1); // Indicate model loaded
          setLoadedFileIdentifier(newFileIdentifier); // Store identifier of the successfully loaded file
          setErrorMessage(null);
        })
        .catch(error => {
          console.error(`Error loading IFC (${file.name}) in viewer node:`, error);
          setErrorMessage(`Failed to load ${file.name}. See console.`);
          setElementCount(0);
          setLoadedFileIdentifier(null); // Clear identifier on error
          // viewer.clear() is called within loadIfc's catch block
        })
        .finally(() => {
          setIsLoading(false); // Ensure loading is set to false
        });

      // Depend on the file object identifier and the viewer instance
    }, [data.inputData?.file, viewer, loadedFileIdentifier]); // Added loadedFileIdentifier to dependencies

    // Used to determine if we should disable dragging - when resizing
    const nodeDraggable = !isResizing;

    return (
      <div
        className={`bg-white dark:bg-gray-800 border-2 ${isInFocusMode
          ? "border-cyan-400 dark:border-cyan-300 shadow-xl shadow-cyan-400/50 ring-4 ring-cyan-300/20"
          : selected
            ? "border-cyan-600 dark:border-cyan-400"
            : "border-cyan-500 dark:border-cyan-400"
          } rounded-md shadow-md relative transition-all duration-300`}
        style={{
          width: `${width}px`,
          zIndex: isInFocusMode ? 1000 : 'auto',
          ...(isInFocusMode && {
            filter: 'drop-shadow(0 0 12px rgba(34, 211, 238, 0.5)) drop-shadow(0 0 20px rgba(34, 211, 238, 0.2))', // Layered neon glow
          })
        }}
        data-id={id}
        onMouseEnter={(e) => {
          if (isInFocusMode) {
            e.stopPropagation();
          }
        }}
        onMouseLeave={(e) => {
          if (isInFocusMode) {
            e.stopPropagation();
          }
        }}
      >
        <div className={`${isInFocusMode ? "bg-cyan-500 shadow-lg shadow-cyan-400/60 border-b border-cyan-300/30" : "bg-cyan-500"} text-white px-3 py-1 flex items-center justify-between gap-2 nodrag-handle transition-all duration-300`}>
          <div className="flex items-center gap-2 min-w-0">
            <Cube className="h-4 w-4 flex-shrink-0" />
            <div className="text-sm font-medium truncate">{data.label}</div>
            {isInFocusMode && <Focus className="h-3 w-3 flex-shrink-0 text-cyan-200 animate-pulse" />}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {!isLoading && errorMessage && <AlertCircle className="h-4 w-4 text-red-300" />}
            {!isLoading && !errorMessage && elementCount > 0 && <CheckCircle className="h-4 w-4 text-green-300" />}
          </div>
        </div>
        <div className="p-3">
          <div
            ref={viewerRef}
            className={`bg-gray-100 rounded-md flex items-center justify-center overflow-hidden ${isInFocusMode ? "ring-2 ring-cyan-400/30 shadow-inner" : "nodrag"
              } relative cursor-pointer transition-all duration-300`}
            style={{
              height: `${viewerHeight}px`,
              zIndex: isInFocusMode ? 50 : 'auto' // Ensure viewer is on top when in focus mode
            }}
            onDoubleClick={handleViewerDoubleClick}
            // Minimal event handling - let Three.js controls work naturally
            onContextMenu={(e) => {
              if (isInFocusMode) {
                e.stopPropagation(); // Prevent ReactFlow context menu
              }
            }}
          >
            {isLoading && (
              <div className="absolute inset-0 bg-gray-400 bg-opacity-50 flex items-center justify-center z-10">
                <div className="text-white text-sm font-medium">Loading...</div>
              </div>
            )}
            {errorMessage && !isLoading && (
              <div className="absolute inset-0 bg-red-100 bg-opacity-90 flex items-center justify-center z-10 p-2 text-center">
                <div className="text-red-700 text-xs font-medium">{errorMessage}</div>
              </div>
            )}
            {!elementCount && !isLoading && !errorMessage && (
              <div className="text-xs text-muted-foreground pointer-events-none text-center">
                <MousePointer2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Connect IFC File</p>
              </div>
            )}

            {/* Focus mode overlay when viewer is ready */}
            {!isInFocusMode && elementCount > 0 && !isLoading && !errorMessage && (
              <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition-all duration-200 flex items-center justify-center pointer-events-none">
                <div className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 shadow-lg opacity-0 hover:opacity-100 transition-opacity duration-200">
                  <div className="text-xs font-medium text-center flex items-center gap-2">
                    <Focus className="h-4 w-4" />
                    Double-click for 3D controls
                  </div>
                </div>
              </div>
            )}

            {/* Focus mode active indicator */}
            {isInFocusMode && (
              <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1 shadow-lg z-20">
                <Focus className="h-3 w-3" />
                3D Focus
              </div>
            )}
          </div>
          <div className="mt-2 text-xs">
            <div className="flex justify-between">
              <span>View Mode:</span>
              <span className="font-medium">
                {data.properties?.viewMode || "Shaded"}
              </span>
            </div>
            {elementCount > 0 && !isLoading && !errorMessage && (
              <div className="flex justify-between mt-1 text-green-700">
                <span>Status:</span>
                <span className="font-medium">
                  {isInFocusMode ? "3D Focus Active" : "Model Loaded"}
                </span>
              </div>
            )}

            {/* Instructions for focus mode */}
            {isInFocusMode && (
              <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 text-center">
                Click canvas to exit 3D focus mode
              </div>
            )}
            {errorMessage && !isLoading && (
              <div className="flex justify-between mt-1 text-red-700">
                <span>Status:</span>
                <span className="font-medium">Load Error</span>
              </div>
            )}
          </div>
        </div>

        <div
          className={`absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize nodrag ${selected ? "text-cyan-600" : "text-gray-400"
            } hover:text-cyan-500 ${isInFocusMode ? "opacity-30 pointer-events-none" : ""}`}
          onMouseDown={!isInFocusMode ? startResize : undefined}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M22 2L2 22"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M22 10L10 22"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M22 18L18 22"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <Handle
          type="target"
          position={Position.Left}
          id="input"
          style={{ background: "#555", width: 8, height: 8 }}
          isConnectable={isConnectable}
        />
      </div>
    );
  }
);

ViewerNode.displayName = "ViewerNode";
