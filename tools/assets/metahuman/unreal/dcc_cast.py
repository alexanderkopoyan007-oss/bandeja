# The DCC export of a cast MetaHuman (its eyes', teeth's and lashes' baked maps, which the Optimized build doesn't
# write) into cast/<NAME>/dcc. Set NAME first, as conform_cast.py. Logs to cast/<NAME>/dcc.log.
import unreal, os, traceback

CAST = os.path.expanduser('~/bandeja-people-src/cast/' + NAME)
LOG = os.path.join(CAST, 'dcc.log')
open(LOG, 'w').close()
ch = unreal.load_asset('/Game/Cast/%s/MHC_%s' % (NAME, NAME))
sub = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
added = not sub.is_object_added_for_editing(ch) and bool(sub.try_add_object_to_edit(ch))
try:
    p = unreal.MetaHumanDCCExportParams()
    p.external_path = os.path.join(CAST, 'dcc')
    p.bake_make_up = True
    p.compress_in_zip_file = False
    p.archive_name = NAME
    r = unreal.MetaHumanCharacterExportBlueprintLibrary.export_dcc(ch, p)
    open(LOG, 'a').write('export_dcc returned %s\n' % (r,))
except Exception:
    open(LOG, 'a').write(traceback.format_exc())
finally:
    if added and sub.is_object_added_for_editing(ch):
        sub.remove_object_to_edit(ch)
