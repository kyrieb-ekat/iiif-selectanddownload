README.md# IIIF Presentation API v2.1 to v3 Converter

A comprehensive web-based tool for converting IIIF (International Image Interoperability Framework) Presentation API manifests from version 2.1 to version 3.0.

## Table of Contents
- [Overview](#overview)
- [How It Works](#how-it-works)
- [Key Differences Between v2.1 and v3](#key-differences-between-v21-and-v3)
- [Conversion Decisions & Rationale](#conversion-decisions--rationale)
- [Usage Guide](#usage-guide)
- [Technical Implementation](#technical-implementation)
- [Validation Fixes](#validation-fixes)
- [Limitations & Considerations](#limitations--considerations)

## Overview

The IIIF Presentation API defines how cultural heritage institutions can share digital objects (images, audio, video, texts) in a standardized, interoperable way. Version 3.0, released in 2020, introduced significant changes that improve internationalization, simplify the data model, and enhance extensibility.

This tool automates the complex process of converting v2.1 manifests to v3 format, handling the numerous structural and semantic changes required.

## How It Works

### Core Process
1. **Parse Input**: Validates and parses the v2.1 manifest JSON
2. **Structural Transformation**: Applies systematic conversions based on v3 specifications
3. **Language Map Conversion**: Transforms all text strings to internationalization-ready language maps
4. **Type System Updates**: Converts the JSON-LD type system from v2.1 to v3
5. **Array Normalization**: Ensures properties that must be arrays in v3 are properly formatted
6. **Validation**: Produces v3-compliant output ready for validation

### Architecture
- **Frontend-only**: Pure JavaScript implementation requiring no server
- **Modular Design**: Separate conversion functions for different manifest components
- **Error Handling**: Comprehensive validation and user feedback
- **Statistics Tracking**: Monitors conversion operations for transparency

## Key Differences Between v2.1 and v3

### 1. **Internationalization (I18n)**
**v2.1**: Text values are simple strings
```json
{
  "label": "Bodleian Library MS. Canon. Bibl. Lat. 61"
}
```

**v3**: Text values are language maps
```json
{
  "label": {
    "none": ["Bodleian Library MS. Canon. Bibl. Lat. 61"]
  }
}
```

**Why**: Enables proper multilingual support and accessibility

### 2. **JSON-LD Context Changes**
**v2.1**: Context as string
```json
{
  "@context": "http://iiif.io/api/presentation/2/context.json"
}
```

**v3**: Context as array with updated URL
```json
{
  "@context": [
    "http://iiif.io/api/presentation/3/context.json"
  ]
}
```

**Why**: Allows for context composition and namespace management

### 3. **Property Naming Convention**
**v2.1**: JSON-LD style with @ prefix
```json
{
  "@id": "https://example.org/manifest",
  "@type": "sc:Manifest"
}
```

**v3**: Simplified naming
```json
{
  "id": "https://example.org/manifest",
  "type": "Manifest"
}
```

**Why**: Reduces complexity and improves developer experience

### 4. **Type System Simplification**
**v2.1**: Namespace-prefixed types
- `sc:Manifest` → `Manifest`
- `sc:Canvas` → `Canvas` 
- `oa:Annotation` → `Annotation`

**v3**: Clean, simple type names

### 5. **Array Consistency**
**v2.1**: Mixed single objects and arrays
```json
{
  "rendering": {
    "@id": "https://example.org/view",
    "label": "View"
  }
}
```

**v3**: Consistent array usage
```json
{
  "rendering": [{
    "id": "https://example.org/view",
    "label": {"none": ["View"]}
  }]
}
```

### 6. **Behavioral Changes**
**v2.1**: `viewingHint` as string
```json
{
  "viewingHint": "paged"
}
```

**v3**: `behavior` as array
```json
{
  "behavior": ["paged"]
}
```

## Conversion Decisions & Rationale

### Language Map Strategy
**Decision**: Convert all text strings to `{"none": [value]}` format

**Rationale**: 
- Maintains compatibility while enabling future internationalization
- The "none" language code is standard for unspecified languages
- Array format allows for multiple values per language
- Preserves original text content without assuming language

### Array Normalization
**Decision**: Wrap single objects in arrays for properties requiring arrays in v3

**Rationale**:
- v3 specification mandates arrays for certain properties (`rendering`, `thumbnail`, `logo`)
- Ensures forward compatibility
- Maintains semantic meaning while updating structure
- Prevents validation errors

### Type Conversion
**Decision**: Use lookup table for systematic type conversion

**Rationale**:
- Ensures consistency across all converted manifests
- Handles namespace removal systematically
- Maintains semantic equivalence
- Future-proof against type system changes

### Metadata Handling
**Decision**: Convert both labels and values in metadata arrays

**Rationale**:
- Metadata is heavily used for descriptive information
- Both labels and values need internationalization support
- Maintains searchability and accessibility
- Follows v3 specification requirements

### Canvas Structure
**Decision**: Wrap images in AnnotationPage structure

**Rationale**:
- v3 introduces AnnotationPage as intermediate container
- Enables better annotation organization
- Maintains painting annotation semantics
- Prepares for advanced annotation features

### Backward Compatibility
**Decision**: Preserve non-conflicting v2.1 properties

**Rationale**:
- Minimizes data loss during conversion
- Allows for gradual migration strategies
- Maintains institutional customizations
- Enables hybrid implementations during transition

## Usage Guide

### Basic Usage
1. **Load Manifest**: 
   - Paste JSON directly into input area
   - Or use "Load JSON File" to upload a file

2. **Convert**: 
   - Click "Convert to v3" button
   - Review conversion statistics

3. **Validate**: 
   - Check output for correctness
   - Use external validators if needed

4. **Download**: 
   - Save converted manifest as JSON file

### File Handling
- **Supported Formats**: JSON files (.json)
- **Size Limits**: Handles large manifests (tested up to several MB)
- **Encoding**: UTF-8 support for international characters

### Error Handling
- **JSON Validation**: Input validation before conversion
- **Conversion Errors**: Detailed error messages with context
- **Output Validation**: Ensures valid JSON output

## Technical Implementation

### Core Functions

#### `convertToV3(manifest)`
Main conversion orchestrator that:
- Initializes conversion statistics
- Applies systematic transformations
- Handles top-level manifest properties

#### `convertToLanguageMap(value)`
Handles text internationalization:
```javascript
// String → Language Map
"Title" → {"none": ["Title"]}

// Array → Language Map  
["Title1", "Title2"] → {"none": ["Title1", "Title2"]}

// Object → Normalized Language Map
{"en": "Title"} → {"en": ["Title"]}
```

#### `convertResource(resource)`
Transforms resource objects (images, links, services):
- Updates property names (@id → id)
- Converts labels to language maps
- Preserves service information

#### `convertCanvas(canvas)`
Handles Canvas-specific conversions:
- Wraps images in AnnotationPage structure
- Converts otherContent to annotations
- Maintains spatial properties

### Data Flow
```
v2.1 Input → JSON Parse → Structure Analysis → 
Property Conversion → Language Map Creation → 
Array Normalization → Type Updates → v3 Output
```

## Validation Fixes

The tool specifically addresses common validation errors:

### Language String Errors
- **Error**: `'Title' is not of type 'object'`
- **Fix**: Convert to `{"none": ["Title"]}`

### Missing ID/Type Properties
- **Error**: `'id' is a required property`
- **Fix**: Convert `@id` to `id`, `@type` to `type`

### Context Format Issues
- **Error**: Context not array
- **Fix**: Wrap in array and update URL

### Array Type Mismatches
- **Error**: Object where array expected
- **Fix**: Wrap single objects in arrays

## Limitations & Considerations

### Current Limitations
1. **Advanced Annotations**: Complex annotation structures may need manual review
2. **Custom Extensions**: Institution-specific extensions preserved but not validated
3. **Service Blocks**: Advanced service configurations may need verification
4. **Ranges/Structures**: Complex hierarchical structures require careful testing

### Best Practices
1. **Backup Originals**: Always keep original v2.1 manifests
2. **Validation**: Use official IIIF validators after conversion
3. **Testing**: Test converted manifests in target viewers
4. **Incremental Migration**: Convert and test small batches first

### Migration Strategy
1. **Phase 1**: Convert and validate manifests
2. **Phase 2**: Test in production viewers
3. **Phase 3**: Update infrastructure to serve v3
4. **Phase 4**: Deprecate v2.1 endpoints

### Quality Assurance
- **Automated Testing**: Built-in JSON validation
- **Manual Review**: Complex manifests benefit from human review
- **Community Testing**: Share results with IIIF community for feedback

## Contributing

The tool is designed to be extensible. Areas for improvement:
- Additional validation rules
- Custom conversion mappings
- Batch processing capabilities
- Integration with IIIF validators
- Support for Collection-level manifests

## Resources

- [IIIF Presentation API 3.0 Specification](https://iiif.io/api/presentation/3.0/)
- [IIIF Migration Guide](https://iiif.io/api/presentation/3.0/change-log/)
- [IIIF Community](https://iiif.io/community/)
- [Presentation API Validator](https://presentation-validator.iiif.io/)

---

*This tool was created to support the IIIF community's migration to Presentation API v3. For questions, issues, or contributions, please engage with the broader IIIF community.*