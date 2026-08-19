import argparse
import math
import sys
from pathlib import Path

import bpy


def linear_channel(value):
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def checker_color(hex_value):
    return tuple(linear_channel(int(hex_value[index:index + 2], 16)) for index in (0, 2, 4)) + (1.0,)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.materials, bpy.data.images):
        for datablock in collection:
            collection.remove(datablock)


def create_checker_image():
    image = bpy.data.images.new('SuzanneChecker', width=64, height=64, alpha=True)
    dark = checker_color('8b8e94')
    light = checker_color('c5c8ce')
    pixels = []
    for y in range(64):
        for x in range(64):
            pixels.extend(dark if ((x // 8) + (y // 8)) % 2 == 0 else light)
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def create_material(image):
    material = bpy.data.materials.new('SuzanneMaterial')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    material.node_tree.links.new(texture.outputs['Color'], principled.inputs['Base Color'])
    principled.inputs['Metallic'].default_value = 0.0
    principled.inputs['Roughness'].default_value = 0.8
    principled.inputs['Alpha'].default_value = 1.0
    return material


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    script_args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(script_args)

    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source))

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not mesh_objects:
        raise RuntimeError('The source glTF contains no mesh objects')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    if len(mesh_objects) > 1:
        bpy.ops.object.join()
    suzanne = bpy.context.active_object
    suzanne.name = 'Suzanne'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    for obj in list(bpy.context.scene.objects):
        if obj.type in {'CAMERA', 'LIGHT'}:
            bpy.data.objects.remove(obj, do_unlink=True)
    for polygon in suzanne.data.polygons:
        polygon.use_smooth = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
    bpy.ops.object.mode_set(mode='OBJECT')

    suzanne.data.materials.clear()
    suzanne.data.materials.append(create_material(create_checker_image()))
    bpy.ops.object.select_all(action='DESELECT')
    suzanne.select_set(True)
    bpy.context.view_layer.objects.active = suzanne
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format='GLB',
        export_image_format='AUTO',
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_materials='EXPORT',
        use_selection=True,
    )


if __name__ == '__main__':
    main()
