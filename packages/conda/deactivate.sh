# xclang: its bin/ out of PATH again.
PATH=":${PATH}:"
PATH="${PATH//:${CONDA_PREFIX}\/opt\/xclang\/bin:/:}"
PATH="${PATH#:}"
export PATH="${PATH%:}"
