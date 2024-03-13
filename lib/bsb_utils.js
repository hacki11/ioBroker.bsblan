const bsbSort = (a, b) => {
    return bsbcode(a).localeCompare(bsbcode(b));
};

function bsbcode(param) {
    const dest = param.split("!")[1] ?? "0";
    const address = param.split(".")[1] ?? "0";
    const parameter = param.split(/[!.]/)[0];

    return dest + parameter.padStart(5, "0") + "." + address;
}

module.exports = {
    bsbSort,
    bsbcode
};