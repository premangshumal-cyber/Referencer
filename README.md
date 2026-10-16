# Referencer

Referencer is a local-first scientific image calibration and vector digitization web application. It produces actual ESRI Shapefiles with calibrated Cartesian coordinates.

## Quick start

1. Import a PNG, JPEG, WebP or BMP plot image in the workspace.
2. Choose Affine (3+ non-collinear control points), Axis aligned (2+ references varying in both axes) or Projective (4+ control points).
3. Click Pick reference locations, click known image positions, enter Graph X/Y in the control table, and click Calibrate image.
4. Hover to verify graph coordinates and numerical RMS pixel residuals.
5. Choose Point, Line or Polygon. Click vertices. Press Enter or double-click to finish lines and polygons; Escape cancels.
6. Choose Select to move features and individual vertex handles. Open the Inspector to see measurements and edit feature attributes.
7. Click Export data, choose a layer and Download Shapefile ZIP.
8. In QGIS, use Layer > Add Vector Layer on the extracted SHP. In ArcGIS Pro use Map > Add Data on the extracted SHP.
9. Save project downloads a self-contained JSON project with its embedded original image. Open project reopens it. Browser autosave uses IndexedDB.

## Calibration and GIS semantics

All feature vertices are stored as original image pixels, independent of screen zoom/pan. Affine calibration fits a 6-parameter transform by least-squares. Axis mode fits two independent linear relationships. Projective mode fits an 8-parameter planar homography (not lens-distortion correction). Log10 axes are handled in logarithmic coordinates and converted back. Singular, duplicate or collinear controls are rejected and calibration reports inverse pixel residuals.

ZIP includes genuine SHP, SHX, DBF, CPG and optional PRJ. PRJ is included only if user explicitly selects EPSG:4326 or EPSG:3857. Arbitrary graph coordinates NEVER automatically become latitude and longitude.

Lengths and polygon areas are coordinate-space computations unless coordinates and units justify physical interpretations. Geographic longitude/latitude uses great-circle length and approximate spherical area. EPSG:3857 distances and areas are projected and subject to map distortion. Two-axis plots with incompatible units cannot represent ordinary physical distance or area. An affine world file can be downloaded for local or projected coordinates.

## Exports

Shapefile ZIP per geometry-homogeneous layer, full vertex CSV, GCP CSV, JSON project, SVG and PNG rendering, and affine world file when appropriate.

## Development

Uses modern browser JavaScript modules, no runtime dependencies or external APIs. Node.js 20+ for tests and build.

    npm run test
    npm run build

Vercel build command: npm run check
Vercel output directory: dist

Tests validate affine/axis/projective/logarithmic calibration, geometry, inverse transform, Shapefile binaries, and CSV values. GitHub Actions rechecks the same tests on each push.

## Limitations

This release supports one image per project. Advanced functions not yet available: TIFF decoding, multipage/project images, polygon holes, intermediate-vertex insertion/deletion, splitting and joining lines, automated line tracing, CRS transformation, coordinate-preserving recalibration and GeoTIFF raster rectification. Topology validation detects simple polygon self-intersections; it is not a full topology engine. Only EPSG:4326 and EPSG:3857 built-in coordinate reference definitions are provided. Shapefile custom attributes are flattened and abbreviated to traditional DBF names.

Digitized Shapefiles should be independently inspected in QGIS or ArcGIS Pro for important scientific applications.

## Privacy

Scientific images are processed and stored inside the browser. There is no backend upload API or analytics. A downloaded project file embeds the original image and must be protected like any source dataset.
