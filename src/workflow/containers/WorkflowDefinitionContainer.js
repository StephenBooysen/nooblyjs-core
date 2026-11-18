/**
 * @fileoverview Workflow Definition Container
 * Stores and manages workflow definitions with metadata.
 * Provides storage, retrieval, and update functionality for workflow definitions.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 */

'use strict';

/**
 * WorkflowDefinitionContainer - Manages workflow definitions
 * Stores complete workflow definitions with metadata, creation/update timestamps,
 * and execution statistics.
 */
class WorkflowDefinitionContainer {
  /**
   * Creates a new WorkflowDefinitionContainer instance.
   */
  constructor() {
    /** @private {Map<string, Object>} Map of workflow names to definition objects */
    this.definitions = new Map();
  }

  /**
   * Creates or updates a workflow definition.
   * @param {string} name - Unique workflow name
   * @param {Array<string>} steps - Array of step file paths
   * @param {Object} metadata - Optional metadata (description, tags, etc.)
   * @return {Object} The created/updated workflow definition
   */
  define(name, steps, metadata = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Workflow name must be a non-empty string');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Steps must be a non-empty array');
    }

    const now = new Date().toISOString();
    const isUpdate = this.definitions.has(name);

    const definition = {
      name,
      steps,
      metadata: {
        ...metadata,
        description: metadata.description || '',
        tags: metadata.tags || [],
        createdAt: isUpdate ? this.definitions.get(name).metadata.createdAt : now,
        updatedAt: now,
        version: isUpdate ? (this.definitions.get(name).metadata.version || 1) + 1 : 1
      }
    };

    this.definitions.set(name, definition);

    return definition;
  }

  /**
   * Retrieves a workflow definition by name.
   * @param {string} name - Workflow name
   * @return {Object|null} The workflow definition or null if not found
   */
  get(name) {
    return this.definitions.get(name) || null;
  }

  /**
   * Retrieves all workflow definitions.
   * @param {Object} options - Filter options
   * @param {Array<string>} options.tags - Filter by tags
   * @return {Array<Object>} Array of workflow definitions
   */
  getAll(options = {}) {
    let definitions = Array.from(this.definitions.values());

    if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
      definitions = definitions.filter(def =>
        options.tags.some(tag => def.metadata.tags.includes(tag))
      );
    }

    return definitions.sort((a, b) =>
      new Date(b.metadata.updatedAt) - new Date(a.metadata.updatedAt)
    );
  }

  /**
   * Updates workflow definition steps.
   * @param {string} name - Workflow name
   * @param {Array<string>} steps - New steps array
   * @return {Object} Updated definition
   */
  updateSteps(name, steps) {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Workflow '${name}' not found`);
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Steps must be a non-empty array');
    }

    definition.steps = steps;
    definition.metadata.updatedAt = new Date().toISOString();
    definition.metadata.version = (definition.metadata.version || 1) + 1;

    this.definitions.set(name, definition);
    return definition;
  }

  /**
   * Updates workflow metadata.
   * @param {string} name - Workflow name
   * @param {Object} metadata - Metadata to update
   * @return {Object} Updated definition
   */
  updateMetadata(name, metadata) {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Workflow '${name}' not found`);
    }

    definition.metadata = {
      ...definition.metadata,
      ...metadata,
      updatedAt: new Date().toISOString(),
      createdAt: definition.metadata.createdAt,
      version: (definition.metadata.version || 1) + 1
    };

    this.definitions.set(name, definition);
    return definition;
  }

  /**
   * Renames a workflow definition, keeping its steps and metadata.
   * @param {string} oldName - Current workflow name
   * @param {string} newName - New workflow name
   * @return {Object} The renamed definition
   * @throws {Error} When the workflow is missing or the new name is taken
   */
  rename(oldName, newName) {
    const definition = this.definitions.get(oldName);
    if (!definition) {
      throw new Error(`Workflow '${oldName}' not found`);
    }
    if (!newName || typeof newName !== 'string') {
      throw new Error('Workflow name must be a non-empty string');
    }
    if (oldName === newName) return definition;
    if (this.definitions.has(newName)) {
      throw new Error(`Workflow '${newName}' already exists`);
    }

    this.definitions.delete(oldName);
    definition.name = newName;
    definition.metadata = {
      ...definition.metadata,
      updatedAt: new Date().toISOString(),
      version: (definition.metadata.version || 1) + 1
    };
    this.definitions.set(newName, definition);
    return definition;
  }

  /**
   * Deletes a workflow definition.
   * @param {string} name - Workflow name
   * @return {boolean} True if deleted, false if not found
   */
  delete(name) {
    return this.definitions.delete(name);
  }

  /**
   * Checks if a workflow definition exists.
   * @param {string} name - Workflow name
   * @return {boolean} True if exists
   */
  exists(name) {
    return this.definitions.has(name);
  }

  /**
   * Returns the count of workflow definitions.
   * @return {number} Number of definitions
   */
  count() {
    return this.definitions.size;
  }

  /**
   * Clears all workflow definitions.
   */
  clear() {
    this.definitions.clear();
  }

  /**
   * Exports definitions to JSON-compatible format.
   * @return {Object} Definitions as plain object
   */
  export() {
    const exported = {};
    this.definitions.forEach((def, name) => {
      exported[name] = def;
    });
    return exported;
  }

  /**
   * Imports definitions from JSON-compatible format.
   * @param {Object} data - Definitions to import
   */
  import(data) {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Import data must be a valid object');
    }

    Object.entries(data).forEach(([name, definition]) => {
      if (definition.steps && Array.isArray(definition.steps)) {
        this.definitions.set(name, definition);
      }
    });
  }
}

module.exports = WorkflowDefinitionContainer;
