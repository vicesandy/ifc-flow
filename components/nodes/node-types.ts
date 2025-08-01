// Common base interface for all node data
export interface BaseNodeData {
    label: string;
    properties?: Record<string, any>;
}

// Analysis node data
export interface AnalysisNodeData extends BaseNodeData {
    properties?: {
        analysisType?: string;
        tolerance?: string;
        metric?: string;
        [key: string]: any;
    };
}

// Classification node data
export interface ClassificationNodeData extends BaseNodeData {
    properties?: {
        system?: string;
        action?: string;
        code?: string;
        [key: string]: any;
    };
}

// Export node data
export interface ExportNodeData extends BaseNodeData {
    properties?: {
        format?: string;
        fileName?: string;
        [key: string]: any;
    };
}

// Filter node data
export interface FilterNodeData extends BaseNodeData {
    properties?: {
        filterType?: string;
        property?: string;
        value?: string;
        operator?: string;
        [key: string]: any;
    };
}

// Geometry node data
export interface GeometryNodeData extends BaseNodeData {
    properties?: {
        operation?: string;
        [key: string]: any;
    };
}

// IFC node data
export interface IfcNodeData extends BaseNodeData {
    properties?: {
        filename?: string;
        filesize?: number;
        elementCount?: number;
        [key: string]: any;
    };
}

// Parameter node data
export interface ParameterNodeData extends BaseNodeData {
    properties?: {
        name?: string;
        type?: string;
        defaultValue?: any;
        [key: string]: any;
    };
}

// Python node data
export interface PythonNodeData extends BaseNodeData {
    properties?: {
        code?: string;
        [key: string]: any;
    };
    isLoading?: boolean;
    error?: string | null;
    result?: any;
    progress?: {
        percentage: number;
        message?: string;
    } | null;
}

// Property node data
export interface PropertyNodeData extends BaseNodeData {
    properties?: {
        property?: string;
        action?: string;
        value?: string;
        [key: string]: any;
    };
}

// Quantity node data
export interface QuantityNodeData extends BaseNodeData {
    properties?: {
        quantityType?: 'area' | 'volume' | 'length' | 'count';
        groupBy?: 'none' | 'type' | 'level' | 'material';
        unit?: string;
        [key: string]: any;
    };
    messageId?: string;
}

// Relationship node data
export interface RelationshipNodeData extends BaseNodeData {
    properties?: {
        relationType?: string;
        [key: string]: any;
    };
}

// Spatial node data
export interface SpatialNodeData extends BaseNodeData {
    properties?: {
        structureType?: string;
        level?: string;
        [key: string]: any;
    };
}

// Transform node data
export interface TransformNodeData extends BaseNodeData {
    properties?: {
        operation?: string;
        x?: number;
        y?: number;
        z?: number;
        angle?: number;
        [key: string]: any;
    };
}

// Viewer node data
export interface ViewerNodeData extends BaseNodeData {
    properties?: {
        viewerMode?: string;
        [key: string]: any;
    };
}

// Watch node data
export interface WatchNodeData extends BaseNodeData {
    properties?: {
        watchType?: string;
        [key: string]: any;
    };
} 