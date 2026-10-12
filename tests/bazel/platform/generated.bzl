"""A file written by a tool the build runs, built for the host."""

def _generated_impl(ctx):
    out = ctx.actions.declare_file(ctx.label.name + ".txt")
    ctx.actions.run(executable = ctx.executable.tool, arguments = [out.path], outputs = [out])
    return [DefaultInfo(files = depset([out]))]

generated = rule(
    implementation = _generated_impl,
    attrs = {"tool": attr.label(executable = True, cfg = "exec", mandatory = True)},
)
