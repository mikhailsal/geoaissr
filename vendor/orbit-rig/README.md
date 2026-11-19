# Orbit Studio character rig

This package contains the procedural meshes, wardrobe catalog, skeletal animator and software rasterizer from Orbit Studio v3, source revision `d483efc259a1714a30b36b9f0c11dae4e4f6de66`. It uses the upstream module layout so that changes to styles or gestures can be compared with Studio.

The application supplies Three.js r160 through npm. The optional head-decorator callback runs during assembly so custom robot details follow the same skeleton and batching path as the standard face. GeoAIssr owns the display scheduler, robot decoration and component lifecycle in `web/src/lib/orbit`.
